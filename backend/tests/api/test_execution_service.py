"""Unit tests for execution service layer (REQ-5.2.4.6).

This module tests the execution service layer that handles business logic
for execution control and monitoring operations.

Test Coverage:
- Execution CRUD: Create, read, list executions with unique identifiers
- State Machine: State transitions with validation (pending→running→paused→passed)
- Progress Tracking: Progress calculation at plugin boundaries
- Variable Snapshots: Runtime variable state with secret masking
- Log Management: Log storage with severity filtering
- Timeline Tracking: Per-block timing and duration calculation
- Statistics Aggregation: Success rates, durations, trends
- Concurrency: Independent execution contexts
"""

import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import patch

import pytest

from tests.api.suite_test_helpers import make_test_ids
from wavecore.api.exceptions import ConflictException, NotFoundException, ValidationException

# Valid execution states
VALID_EXECUTION_STATES = [
    "running",
    "paused",
    "passed",
    "failed",
    "stopped",
]

# Valid entity types
VALID_ENTITY_TYPES = ["test", "suite", "regression"]

# Shared test environment ID (must match conftest.py seed_test_environment fixture)
TEST_ENV_ID = "env-test-00000000-0000-0000-0000-000000000001"


class TestStartExecution:
    """Test suite for start_execution service function."""

    def test_start_execution_creates_execution_with_unique_id(self) -> None:
        """Test that start_execution creates execution with unique UUID."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        # Mock the entity lookup
        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test-1"}
        ):
            result = execution_service.start_execution(
                entity_type="test",
                entity_id=entity_id,
                environment_id=TEST_ENV_ID,
            )

            assert "id" in result
            # Verify it's a valid UUID
            uuid.UUID(result["id"])
            assert result["entity_type"] == "test"
            assert result["entity_id"] == entity_id
            assert result["status"] == "running"

    def test_start_execution_sets_initial_status_to_running(self) -> None:
        """Test that new executions start in running state."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test-1"}
        ):
            result = execution_service.start_execution(
                entity_type="test",
                entity_id=entity_id,
                environment_id=TEST_ENV_ID,
            )

            assert result["status"] == "running"

    def test_start_execution_records_started_at_timestamp(self) -> None:
        """Test that start_execution records started_at timestamp."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test-1"}
        ):
            result = execution_service.start_execution(
                entity_type="test",
                entity_id=entity_id,
                environment_id=TEST_ENV_ID,
            )

            assert "started_at" in result
            # Verify it's a valid ISO timestamp
            datetime.fromisoformat(result["started_at"].replace("Z", "+00:00"))

    @pytest.mark.parametrize("entity_type", VALID_ENTITY_TYPES)
    def test_start_execution_accepts_valid_entity_types(self, entity_type: str) -> None:
        """Test that start_execution accepts all valid entity types."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        # A suite/regression must carry a member to be executable at all.
        entity = {
            "id": entity_id,
            "name": "entity-1",
            "tests": ["test-1"],
            "suites": ["suite-1"],
        }

        with patch.object(execution_service, "_get_entity", return_value=entity):
            result = execution_service.start_execution(
                entity_type=entity_type,
                entity_id=entity_id,
                environment_id=TEST_ENV_ID,
            )

            assert result["entity_type"] == entity_type

    def test_start_execution_raises_for_invalid_entity_type(self) -> None:
        """Test that start_execution raises ValueError for invalid type."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with pytest.raises(ValidationException, match=r"^Invalid entity type 'invalid'"):
            execution_service.start_execution(
                entity_type="invalid",
                entity_id=entity_id,
                environment_id=TEST_ENV_ID,
            )

    def test_start_execution_raises_when_entity_not_found(self) -> None:
        """Test that start_execution raises LookupError when entity not found."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(execution_service, "_get_entity", return_value=None):
            with pytest.raises(LookupError, match=r"not found"):
                execution_service.start_execution(
                    entity_type="test",
                    entity_id=entity_id,
                    environment_id=TEST_ENV_ID,
                )

    def test_start_execution_stores_variable_overrides(self) -> None:
        """Test that start_execution stores variable overrides."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())
        variables = {"env": "staging", "timeout": 60}

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test-1"}
        ):
            result = execution_service.start_execution(
                entity_type="test",
                entity_id=entity_id,
                environment_id=TEST_ENV_ID,
                variables=variables,
            )

            # Get execution to verify variables stored
            _execution = execution_service.get_execution(result["id"])
            stored_vars = execution_service.get_execution_variables(result["id"])
            assert stored_vars is not None

    def test_start_execution_stores_profile_id(self) -> None:
        """Test that start_execution stores profile_id for regressions."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())
        profile_id = str(uuid.uuid4())

        entity = {"id": entity_id, "name": "regression-1", "suites": ["suite-1"]}

        with patch.object(execution_service, "_get_entity", return_value=entity):
            result = execution_service.start_execution(
                entity_type="regression",
                entity_id=entity_id,
                environment_id=TEST_ENV_ID,
                profile_id=profile_id,
            )

            assert result is not None

    def test_start_execution_stores_version(self) -> None:
        """Test that start_execution stores entity version."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test-1"}
        ):
            result = execution_service.start_execution(
                entity_type="test",
                entity_id=entity_id,
                environment_id=TEST_ENV_ID,
                version="1.2.3",
            )

            assert result["entity_version"] == "1.2.3"

    def test_start_execution_stores_environment_id(self) -> None:
        """Test that start_execution stores environment_id in the execution record."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test-1"}
        ):
            result = execution_service.start_execution(
                entity_type="test",
                entity_id=entity_id,
                environment_id=TEST_ENV_ID,
            )

            assert result["environment_id"] == TEST_ENV_ID

    def test_start_execution_environment_id_retrievable(self) -> None:
        """Test that environment_id is retrievable via get_execution."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test-1"}
        ):
            created = execution_service.start_execution(
                entity_type="test",
                entity_id=entity_id,
                environment_id=TEST_ENV_ID,
            )

            retrieved = execution_service.get_execution(created["id"])
            assert retrieved is not None
            assert retrieved["environment_id"] == TEST_ENV_ID

    def test_start_execution_raises_when_environment_not_found(self) -> None:
        """Test that start_execution raises LookupError for non-existent environment."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())
        bad_env_id = "env-nonexistent-000"

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test-1"}
        ):
            with pytest.raises(
                LookupError, match=r"^Environment with ID 'env-nonexistent-000' not found$"
            ):
                execution_service.start_execution(
                    entity_type="test",
                    entity_id=entity_id,
                    environment_id=bad_env_id,
                )

    def test_start_execution_environment_id_in_list(self) -> None:
        """Test that environment_id appears in execution list results."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test-1"}
        ):
            execution_service.start_execution(
                entity_type="test",
                entity_id=entity_id,
                environment_id=TEST_ENV_ID,
            )

            result = execution_service.list_executions()
            assert len(result["executions"]) >= 1
            assert result["executions"][0]["environment_id"] == TEST_ENV_ID


class TestGetExecution:
    """Test suite for get_execution service function."""

    def test_get_execution_returns_execution_by_id(self) -> None:
        """Test that get_execution returns execution details."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test-1"}
        ):
            created = execution_service.start_execution(
                entity_type="test",
                entity_id=entity_id,
                environment_id=TEST_ENV_ID,
            )

            result = execution_service.get_execution(created["id"])

            assert result is not None
            assert result["id"] == created["id"]
            assert result["entity_type"] == "test"

    def test_get_execution_returns_none_for_unknown_id(self) -> None:
        """Test that get_execution returns None for unknown ID."""
        from wavecore.api.services.executions import service as execution_service

        unknown_id = str(uuid.uuid4())

        result = execution_service.get_execution(unknown_id)

        assert result is None

    def test_get_execution_includes_progress_information(self) -> None:
        """Test that get_execution includes progress for running execution."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test-1"}
        ):
            created = execution_service.start_execution(
                entity_type="test",
                entity_id=entity_id,
                environment_id=TEST_ENV_ID,
            )

            # Simulate running state
            _exec_storage._update_execution_status(created["id"], "running")

            result = execution_service.get_execution(created["id"])

            assert result is not None
            assert "progress" in result or result["status"] == "running"


class TestListExecutions:
    """Test suite for list_executions service function."""

    def test_list_executions_returns_all_executions(self) -> None:
        """Test that list_executions returns all executions."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        # Clear storage for clean test
        _exec_storage._execution_storage.clear()

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test-1"}
        ):
            execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )
            execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

            result = execution_service.list_executions()

            assert len(result["executions"]) == 2
            assert result["total"] == 2

    def test_list_executions_filters_by_status(self) -> None:
        """Test that list_executions filters by status."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._execution_storage.clear()

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test-1"}
        ):
            _exec1 = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )
            exec2 = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

            # Transition second to passed so they differ
            _exec_storage._update_execution_status(exec2["id"], "passed")

            result = execution_service.list_executions(status=["running"])

            assert len(result["executions"]) == 1
            assert result["executions"][0]["status"] == "running"

    def test_list_executions_filters_by_search(self) -> None:
        """Test that list_executions filters by search across name and triggered_by."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._execution_storage.clear()

        # Seed executions with distinct names/triggered_by
        _exec_storage._execution_storage["e1"] = {
            "id": "e1",
            "name": "Login Test",
            "entity_type": "test",
            "status": "running",
            "triggered_by": "alice",
            "started_at": "2026-04-14T00:00:00+00:00",
        }
        _exec_storage._execution_storage["e2"] = {
            "id": "e2",
            "name": "Checkout Test",
            "entity_type": "test",
            "status": "passed",
            "triggered_by": "bob",
            "started_at": "2026-04-14T00:00:00+00:00",
        }
        _exec_storage._execution_storage["e3"] = {
            "id": "e3",
            "name": "Unrelated",
            "entity_type": "test",
            "status": "passed",
            "triggered_by": "alice",
            "started_at": "2026-04-14T00:00:00+00:00",
        }

        # Search matches name (case-insensitive)
        result = execution_service.list_executions(search="login")
        assert len(result["executions"]) == 1
        assert result["executions"][0]["id"] == "e1"

        # Search matches triggered_by
        result = execution_service.list_executions(search="bob")
        assert len(result["executions"]) == 1
        assert result["executions"][0]["id"] == "e2"

        # Search matching multiple rows
        result = execution_service.list_executions(search="alice")
        ids = {e["id"] for e in result["executions"]}
        assert ids == {"e1", "e3"}

    def test_list_executions_filters_by_triggered_by(self) -> None:
        """Test that list_executions filters by triggered_by user (OR list)."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._execution_storage.clear()

        _exec_storage._execution_storage["e1"] = {
            "id": "e1",
            "name": "a",
            "entity_type": "test",
            "status": "running",
            "triggered_by": "alice",
            "started_at": "2026-04-14T00:00:00+00:00",
        }
        _exec_storage._execution_storage["e2"] = {
            "id": "e2",
            "name": "b",
            "entity_type": "test",
            "status": "running",
            "triggered_by": "bob",
            "started_at": "2026-04-14T00:00:00+00:00",
        }
        _exec_storage._execution_storage["e3"] = {
            "id": "e3",
            "name": "c",
            "entity_type": "test",
            "status": "running",
            "triggered_by": "carol",
            "started_at": "2026-04-14T00:00:00+00:00",
        }

        result = execution_service.list_executions(triggered_by=["alice", "bob"])
        ids = {e["id"] for e in result["executions"]}
        assert ids == {"e1", "e2"}

    def test_list_execution_users_returns_unique_sorted_values(self) -> None:
        """Test that list_execution_users returns sorted unique triggered_by values."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._execution_storage.clear()

        _exec_storage._execution_storage["e1"] = {"id": "e1", "triggered_by": "bob"}
        _exec_storage._execution_storage["e2"] = {"id": "e2", "triggered_by": "alice"}
        _exec_storage._execution_storage["e3"] = {"id": "e3", "triggered_by": "alice"}
        _exec_storage._execution_storage["e4"] = {"id": "e4"}  # missing triggered_by

        users = execution_service.list_execution_users()
        assert users == ["alice", "bob"]

    def test_list_executions_filters_by_entity_type(self) -> None:
        """Test that list_executions filters by entity type."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._execution_storage.clear()

        test_id = str(uuid.uuid4())
        suite_id = str(uuid.uuid4())

        entity = {"id": test_id, "name": "entity", "tests": ["test-1"]}

        with patch.object(execution_service, "_get_entity", return_value=entity):
            execution_service.start_execution(
                entity_type="test", entity_id=test_id, environment_id=TEST_ENV_ID
            )
            execution_service.start_execution(
                entity_type="suite", entity_id=suite_id, environment_id=TEST_ENV_ID
            )

            result = execution_service.list_executions(entity_type=["test"])

            assert len(result["executions"]) == 1
            assert result["executions"][0]["entity_type"] == "test"

    def test_list_executions_filters_by_entity_id(self) -> None:
        """Test that list_executions filters by specific entity ID."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._execution_storage.clear()

        entity_id_1 = str(uuid.uuid4())
        entity_id_2 = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id_1, "name": "test"}
        ):
            execution_service.start_execution(
                entity_type="test", entity_id=entity_id_1, environment_id=TEST_ENV_ID
            )
            execution_service.start_execution(
                entity_type="test", entity_id=entity_id_2, environment_id=TEST_ENV_ID
            )

            result = execution_service.list_executions(entity_id=entity_id_1)

            assert len(result["executions"]) == 1
            assert result["executions"][0]["entity_id"] == entity_id_1

    def test_list_executions_supports_pagination(self) -> None:
        """Test that list_executions supports pagination."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._execution_storage.clear()

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            for _ in range(25):
                execution_service.start_execution(
                    entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
                )

            result = execution_service.list_executions(page=2, per_page=10)

            assert len(result["executions"]) == 10
            assert result["page"] == 2
            assert result["per_page"] == 10
            assert result["total"] == 25


class TestPauseExecution:
    """Test suite for pause_execution service function."""

    def test_pause_execution_transitions_to_paused(self) -> None:
        """Test that pause_execution transitions running to paused."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            created = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )
            _exec_storage._update_execution_status(created["id"], "running")

            result = execution_service.pause_execution(created["id"])

            assert result is not None
            assert result["status"] == "paused"

    def test_pause_execution_returns_none_for_unknown_id(self) -> None:
        """Test that pause_execution returns None for unknown ID."""
        from wavecore.api.services.executions import service as execution_service

        unknown_id = str(uuid.uuid4())

        result = execution_service.pause_execution(unknown_id)

        assert result is None

    def test_pause_execution_raises_for_invalid_state(self) -> None:
        """Test that pause_execution raises ConflictException for non-running state."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            created = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )
            # Transition to paused (valid state transition; pause from paused is invalid)
            _exec_storage._update_execution_status(created["id"], "paused")

            with pytest.raises(ConflictException, match=r"Cannot"):
                execution_service.pause_execution(created["id"])


class TestResumeExecution:
    """Test suite for resume_execution service function."""

    def test_resume_execution_transitions_to_running(self) -> None:
        """Test that resume_execution transitions paused to running."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            created = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )
            _exec_storage._update_execution_status(created["id"], "running")
            _exec_storage._update_execution_status(created["id"], "paused")

            result = execution_service.resume_execution(created["id"])

            assert result is not None
            assert result["status"] == "running"

    def test_resume_execution_returns_none_for_unknown_id(self) -> None:
        """Test that resume_execution returns None for unknown ID."""
        from wavecore.api.services.executions import service as execution_service

        unknown_id = str(uuid.uuid4())

        result = execution_service.resume_execution(unknown_id)

        assert result is None

    def test_resume_execution_raises_for_non_paused_state(self) -> None:
        """Test that resume_execution raises ValueError for non-paused state."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            created = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )
            _exec_storage._update_execution_status(created["id"], "running")
            # Execution is in 'running' state, not 'paused'

            with pytest.raises(ConflictException, match=r"Cannot"):
                execution_service.resume_execution(created["id"])


class TestStopExecution:
    """Test suite for stop_execution service function."""

    def test_stop_execution_transitions_to_stopped(self) -> None:
        """Test that stop_execution transitions execution to stopped status."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            created = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )
            _exec_storage._update_execution_status(created["id"], "running")

            result = execution_service.stop_execution(created["id"])

            assert result is not None
            assert result["status"] == "stopped"
            assert "ended_at" in result
            assert "duration" in result
            assert isinstance(result["duration"], int)
            assert result["duration"] >= 0

    def test_terminal_transition_populates_duration_for_passed(self) -> None:
        """Each terminal transition writes a duration field so the Executions
        list can render elapsed time instead of the '-' placeholder."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())
        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "t"}
        ):
            created = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

        _exec_storage._update_execution_status(created["id"], "passed")
        record = _exec_storage._execution_storage[created["id"]]
        assert record["status"] == "passed"
        assert "duration" in record
        assert isinstance(record["duration"], int)
        assert record["duration"] >= 0

    def test_terminal_transition_populates_duration_for_failed(self) -> None:
        """Failed terminal transition writes duration."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())
        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "t"}
        ):
            created = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

        _exec_storage._update_execution_status(created["id"], "failed")
        record = _exec_storage._execution_storage[created["id"]]
        assert record["status"] == "failed"
        assert isinstance(record.get("duration"), int)

    def test_stop_execution_returns_none_for_unknown_id(self) -> None:
        """Test that stop_execution returns None for unknown ID."""
        from wavecore.api.services.executions import service as execution_service

        unknown_id = str(uuid.uuid4())

        result = execution_service.stop_execution(unknown_id)

        assert result is None

    def test_stop_execution_valid_from_running(self) -> None:
        """Test that stop is valid from running state."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            created = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )
            _exec_storage._update_execution_status(created["id"], "running")

            result = execution_service.stop_execution(created["id"])

            assert result is not None

    def test_stop_execution_valid_from_paused(self) -> None:
        """Test that stop is valid from paused state."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            created = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )
            _exec_storage._update_execution_status(created["id"], "running")
            _exec_storage._update_execution_status(created["id"], "paused")

            result = execution_service.stop_execution(created["id"])

            assert result is not None


class TestCancelExecutionRemoved:
    """There is no cancel_execution service function; only stop_execution exists."""

    def test_cancel_execution_not_exported(self) -> None:
        """cancel_execution must not exist on the execution service module."""
        from wavecore.api.services.executions import service as execution_service

        assert not hasattr(execution_service, "cancel_execution"), (
            "cancel_execution service function must be deleted; "
            "stop_execution is the single user-Stop path."
        )


class TestGetExecutionProgress:
    """Test suite for get_execution_progress service function."""

    def test_get_execution_progress_returns_progress(self) -> None:
        """Test that get_execution_progress returns progress info."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            created = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

            result = execution_service.get_execution_progress(created["id"])

            assert result is not None
            assert "current" in result
            assert "total" in result
            assert "percentage" in result

    def test_get_execution_progress_returns_none_for_unknown_id(self) -> None:
        """Test that get_execution_progress returns None for unknown ID."""
        from wavecore.api.services.executions import service as execution_service

        unknown_id = str(uuid.uuid4())

        result = execution_service.get_execution_progress(unknown_id)

        assert result is None


class TestGetExecutionVariables:
    """Test suite for get_execution_variables service function."""

    def test_get_execution_variables_returns_variables(self) -> None:
        """Test that get_execution_variables returns runtime variables."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            created = execution_service.start_execution(
                entity_type="test",
                entity_id=entity_id,
                environment_id=TEST_ENV_ID,
                variables={"env": "production"},
            )

            result = execution_service.get_execution_variables(created["id"])

            assert result is not None
            assert "env" in result

    def test_get_execution_variables_returns_none_for_unknown_id(self) -> None:
        """Test that get_execution_variables returns None for unknown ID."""
        from wavecore.api.services.executions import service as execution_service

        unknown_id = str(uuid.uuid4())

        result = execution_service.get_execution_variables(unknown_id)

        assert result is None

    def test_get_execution_variables_never_masks_by_name(self) -> None:
        """Unflagged variables are NEVER masked, whatever their names."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            created = execution_service.start_execution(
                entity_type="test",
                entity_id=entity_id,
                environment_id=TEST_ENV_ID,
                variables={
                    "username": "admin",
                    "password": "secret123",
                    "api_key": "key-abc-123",
                },
            )

            result = execution_service.get_execution_variables(created["id"])

            assert result is not None
            assert result["username"] == "admin"
            assert result["password"] == "secret123"
            assert result["api_key"] == "key-abc-123"


class TestGetExecutionStatistics:
    """Test suite for get_execution_statistics service function."""

    def test_get_execution_statistics_returns_stats(self) -> None:
        """Test that get_execution_statistics returns aggregate statistics."""
        from wavecore.api.services.executions import service as execution_service

        result = execution_service.get_execution_statistics()

        assert result is not None
        assert "total_executions" in result
        assert "success_rate" in result
        assert "failure_rate" in result
        assert "average_duration_ms" in result

    def test_get_execution_statistics_filters_by_entity_type(self) -> None:
        """Test that get_execution_statistics filters by entity type."""
        from wavecore.api.services.executions import service as execution_service

        result = execution_service.get_execution_statistics(entity_type="test")

        assert result is not None
        assert "total_executions" in result

    def test_get_execution_statistics_filters_by_entity_id(self) -> None:
        """Test that get_execution_statistics filters by entity ID."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        result = execution_service.get_execution_statistics(entity_id=entity_id)

        assert result is not None
        assert "total_executions" in result


class TestStateValidation:
    """Test suite for state transition validation."""

    def test_validate_state_transition_pause(self) -> None:
        """Test that pause is only valid from running state."""
        from wavecore.api.services.executions import _storage as _exec_storage

        # Valid transition
        _exec_storage._validate_state_transition("running", "paused", "pause")

        # Invalid transitions
        for invalid_source in ["paused", "passed", "failed", "stopped"]:
            with pytest.raises(ConflictException, match=r"Cannot"):
                _exec_storage._validate_state_transition(invalid_source, "paused", "pause")

    def test_validate_state_transition_resume(self) -> None:
        """Test that resume is only valid from paused state."""
        from wavecore.api.services.executions import _storage as _exec_storage

        # Valid transition
        _exec_storage._validate_state_transition("paused", "running", "resume")

        # Invalid transitions
        for invalid_source in ["running", "passed", "failed", "stopped"]:
            with pytest.raises(ConflictException, match=r"Cannot"):
                _exec_storage._validate_state_transition(invalid_source, "running", "resume")

    def test_validate_state_transition_stop(self) -> None:
        """Test that stop is valid from running and paused states, target is stopped."""
        from wavecore.api.services.executions import _storage as _exec_storage

        # Valid transitions (stop transitions to stopped)
        _exec_storage._validate_state_transition("running", "stopped", "stop")
        _exec_storage._validate_state_transition("paused", "stopped", "stop")

        # Invalid transitions
        for invalid_source in ["passed", "failed", "stopped"]:
            with pytest.raises(ConflictException, match=r"Cannot"):
                _exec_storage._validate_state_transition(invalid_source, "stopped", "stop")

    def test_validate_state_transition_cancel_op_removed(self) -> None:
        """There is no `cancel` transition op in STATE_TRANSITIONS."""
        from wavecore.api.services.executions import _storage as _exec_storage

        assert "cancel" not in _exec_storage.STATE_TRANSITIONS, (
            "`cancel` transition op must be removed from STATE_TRANSITIONS; " "only `stop` remains."
        )


class TestSecretMasking:
    """Flag-based persistence masking of terminal run state."""

    @staticmethod
    def _seed_terminal_session(session_id: str) -> None:
        """Execution record + workbench session with a run registry attached."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.core.secrets.registry import SecretRegistry

        registry = SecretRegistry()
        registry.register("login", "s3cretlogin99", "declared")

        record = {
            "id": session_id,
            "entity_type": "test",
            "entity_id": str(uuid.uuid4()),
            "environment_id": TEST_ENV_ID,
            "status": "running",
            "run_id": session_id,
            "workflow_snapshot": {"nodes": [], "edges": []},
        }
        _exec_storage._execution_storage[session_id] = record
        _exec_storage._save_execution(record)

        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "test_id": record["entity_id"],
            "status": "running",
            "block_states": {"node-1": "passed"},
            "variables": {
                "login": "s3cretlogin99",
                "copied": "Bearer s3cretlogin99",
                "password": "hunter2",
            },
            "secret_variable_names": ["login"],
            "secret_registry": registry,
        }

    def test_terminal_persistence_masks_by_flag_both_ways(self) -> None:
        """Flagged 'login' masks; unflagged 'password' does NOT (pinned both ways)."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service
        from wavecore.api.services.workbench import _common as _wb_common

        session_id = str(uuid.uuid4())
        self._seed_terminal_session(session_id)
        try:
            execution_service._on_workbench_session_terminated(session_id, "passed", None)

            snapshot = _exec_storage._load_snapshot(session_id, session_id)
            assert snapshot is not None
            assert snapshot["variables"]["login"] == "********"
            assert snapshot["variables"]["copied"] == "Bearer ********"
            assert snapshot["variables"]["password"] == "hunter2"
        finally:
            _wb_common._workbench_sessions.pop(session_id, None)

    def test_get_execution_variables_serves_the_masked_write(self) -> None:
        """The read path returns exactly what was masked on write - no re-guessing."""
        from wavecore.api.services.executions import service as execution_service
        from wavecore.api.services.workbench import _common as _wb_common

        session_id = str(uuid.uuid4())
        self._seed_terminal_session(session_id)
        try:
            execution_service._on_workbench_session_terminated(session_id, "passed", None)

            result = execution_service.get_execution_variables(session_id)

            assert result is not None
            assert result["login"] == "********"
            assert result["copied"] == "Bearer ********"
            assert result["password"] == "hunter2"
        finally:
            _wb_common._workbench_sessions.pop(session_id, None)


class TestStopExecutionStateValidation:
    """Test suite for stop execution state validation."""

    def test_stop_execution_raises_for_passed_state(self) -> None:
        """Test that stop_execution raises for passed state."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            created = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )
            _exec_storage._update_execution_status(created["id"], "running")
            _exec_storage._update_execution_status(created["id"], "passed")

            with pytest.raises(ConflictException, match=r"Cannot"):
                execution_service.stop_execution(created["id"])

    def test_stop_execution_raises_for_failed_state(self) -> None:
        """Test that stop_execution raises for failed state."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            created = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )
            _exec_storage._update_execution_status(created["id"], "running")
            _exec_storage._update_execution_status(created["id"], "failed")

            with pytest.raises(ConflictException, match=r"Cannot"):
                execution_service.stop_execution(created["id"])

    def test_stop_execution_raises_for_stopped_state(self) -> None:
        """Test that stop_execution raises for already-stopped state."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            created = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )
            _exec_storage._update_execution_status(created["id"], "running")
            _exec_storage._update_execution_status(created["id"], "stopped")

            with pytest.raises(ConflictException, match=r"Cannot"):
                execution_service.stop_execution(created["id"])


class TestStatisticsPercentiles:
    """Test suite for statistics percentile calculations."""

    def test_get_execution_statistics_includes_percentiles(self) -> None:
        """Test that get_execution_statistics includes percentile durations."""
        from wavecore.api.services.executions import service as execution_service

        result = execution_service.get_execution_statistics()

        assert result is not None
        assert "p50_duration_ms" in result or "average_duration_ms" in result

    def test_get_execution_statistics_calculates_percentiles(self) -> None:
        """Test that percentiles are calculated from execution data."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        # Create some executions with different durations
        _exec_storage._execution_storage.clear()

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            for _ in range(10):
                exec_data = execution_service.start_execution(
                    entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
                )
                _exec_storage._update_execution_status(exec_data["id"], "running")
                _exec_storage._update_execution_status(exec_data["id"], "passed")

            result = execution_service.get_execution_statistics()

            assert result is not None
            assert "total_executions" in result


class TestListExecutionsSorting:
    """Test suite for list executions sorting."""

    def test_list_executions_sorts_by_started_at(self) -> None:
        """Test that list_executions sorts by started_at."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._execution_storage.clear()

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )
            execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

            result = execution_service.list_executions(sort="started_at", order="desc")

            assert result is not None
            assert "executions" in result

    def test_list_executions_supports_ascending_order(self) -> None:
        """Test that list_executions supports ascending order."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._execution_storage.clear()

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )
            execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

            result = execution_service.list_executions(sort="started_at", order="asc")

            assert result is not None
            assert "executions" in result

    def test_list_executions_sorts_by_name(self) -> None:
        """Test that list_executions sorts by name."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._execution_storage.clear()

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            exec1 = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )
            exec2 = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

            # Set names directly in storage
            _exec_storage._execution_storage[exec1["id"]]["name"] = "Zebra Test"
            _exec_storage._execution_storage[exec2["id"]]["name"] = "Alpha Test"

            result = execution_service.list_executions(sort="name", order="asc")

            assert result is not None
            executions = result["executions"]
            assert len(executions) == 2
            assert executions[0]["name"] == "Alpha Test"
            assert executions[1]["name"] == "Zebra Test"

    def test_list_executions_sorts_by_status(self) -> None:
        """Test that list_executions sorts by status."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._execution_storage.clear()

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            # Create executions with different statuses
            exec1 = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )
            exec2 = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )
            exec3 = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

            # Set different statuses
            _exec_storage._execution_storage[exec1["id"]]["status"] = "failed"
            _exec_storage._execution_storage[exec2["id"]]["status"] = "running"
            _exec_storage._execution_storage[exec3["id"]]["status"] = "passed"

            result = execution_service.list_executions(sort="status", order="asc")

            assert result is not None
            executions = result["executions"]
            # Order: running, passed, failed, canceled
            assert executions[0]["status"] == "running"
            assert executions[1]["status"] == "passed"
            assert executions[2]["status"] == "failed"

    def test_list_executions_sorts_by_triggered_by(self) -> None:
        """Test that list_executions sorts by triggered_by."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._execution_storage.clear()

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            exec1 = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )
            exec2 = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

            # Set triggered_by directly in storage
            _exec_storage._execution_storage[exec1["id"]]["triggered_by"] = "Zack"
            _exec_storage._execution_storage[exec2["id"]]["triggered_by"] = "Alice"

            result = execution_service.list_executions(sort="triggered_by", order="asc")

            assert result is not None
            executions = result["executions"]
            assert executions[0]["triggered_by"] == "Alice"
            assert executions[1]["triggered_by"] == "Zack"

    def test_list_executions_sorts_by_entity_type(self) -> None:
        """Test that list_executions sorts by entity_type (type)."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._execution_storage.clear()

        entity_id_suite = str(uuid.uuid4())
        entity_id_test = str(uuid.uuid4())

        with patch.object(
            execution_service,
            "_get_entity",
            side_effect=[
                {"id": entity_id_suite, "name": "Suite 1", "tests": ["test-1"]},
                {"id": entity_id_test, "name": "Test 1"},
            ],
        ):
            execution_service.start_execution(
                entity_type="suite", entity_id=entity_id_suite, environment_id=TEST_ENV_ID
            )
            execution_service.start_execution(
                entity_type="test", entity_id=entity_id_test, environment_id=TEST_ENV_ID
            )

            result = execution_service.list_executions(sort="type", order="asc")

            assert result is not None
            executions = result["executions"]
            assert executions[0]["entity_type"] == "suite"
            assert executions[1]["entity_type"] == "test"

    def test_list_executions_sorts_by_duration(self) -> None:
        """Test that list_executions sorts by duration."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._execution_storage.clear()

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            exec1 = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )
            exec2 = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )
            exec3 = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

            # Set different durations (None goes last)
            _exec_storage._execution_storage[exec1["id"]]["duration"] = 100
            _exec_storage._execution_storage[exec2["id"]]["duration"] = 50
            _exec_storage._execution_storage[exec3["id"]]["duration"] = None

            result = execution_service.list_executions(sort="duration", order="asc")

            assert result is not None
            executions = result["executions"]
            assert executions[0]["duration"] == 50
            assert executions[1]["duration"] == 100
            assert executions[2]["duration"] is None

    def test_list_executions_sorts_by_completed_at(self) -> None:
        """Test that list_executions sorts by completed_at."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._execution_storage.clear()

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            exec1 = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )
            exec2 = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

            # Set different completed_at times
            _exec_storage._execution_storage[exec1["id"]]["completed_at"] = "2025-01-01T12:00:00Z"
            _exec_storage._execution_storage[exec2["id"]]["completed_at"] = "2025-01-01T10:00:00Z"

            result = execution_service.list_executions(sort="completed_at", order="asc")

            assert result is not None
            executions = result["executions"]
            assert len(executions) == 2
            # Earlier time comes first in ascending order
            assert executions[0]["completed_at"] == "2025-01-01T10:00:00Z"
            assert executions[1]["completed_at"] == "2025-01-01T12:00:00Z"


class TestEdgeCases:
    """Test suite for edge cases and additional coverage."""

    def test_validate_state_transition_raises_for_unknown_operation(self) -> None:
        """Test that _validate_state_transition raises for unknown operation."""
        from wavecore.api.services.executions import _storage as _exec_storage

        with pytest.raises(ValidationException, match="Unknown operation"):
            _exec_storage._validate_state_transition("running", "paused", "unknown_operation")

    def test_get_execution_progress_counts_from_runtime_state(self) -> None:
        """``get_execution_progress`` derives current/total from runtime state."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())
        with patch.object(
            execution_service,
            "_get_entity",
            return_value={"id": entity_id, "name": "test", "workflow": None},
        ):
            created = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )
            progress = execution_service.get_execution_progress(created["id"])
            assert progress is not None
            assert progress["total"] == 1

    def test_terminal_execution_reports_completed_progress(self) -> None:
        """A finished run must not still read 0%: progress is recomputed once the
        execution is terminal, not frozen at the last mid-run poll."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())
        with patch.object(
            execution_service,
            "_get_entity",
            return_value={"id": entity_id, "name": "suite-1", "tests": ["t-1"]},
        ):
            created = execution_service.start_execution(
                entity_type="suite", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

        execution_id = created["id"]
        state = _exec_storage._get_runtime_state(execution_id)
        assert state is not None
        for run in state["runs"].values():
            run["status"] = "passed"
        _exec_storage._execution_storage[execution_id]["status"] = "passed"

        result = execution_service.get_execution(execution_id)

        assert result is not None
        assert result["progress"] == {"current": 1, "total": 1, "percentage": 100.0}

    def test_list_executions_with_order_desc(self) -> None:
        """Test that list_executions with order desc works."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            # Create executions
            execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )
            execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

            # List with desc order
            result = execution_service.list_executions(order="desc")

            assert result is not None
            assert "executions" in result

    def test_list_executions_with_order_asc(self) -> None:
        """Test that list_executions with order asc works."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            # Create executions
            execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

            # List with asc order
            result = execution_service.list_executions(order="asc")

            assert result is not None
            assert "executions" in result

    def test_list_executions_with_from_date_filter(self) -> None:
        """Test that list_executions with from_date filter works."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            # Create an execution
            execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

            # List with from_date in the past
            past_date = datetime(2020, 1, 1, tzinfo=UTC)
            result = execution_service.list_executions(from_date=past_date)

            assert result is not None
            # Should include the execution since it was created after past_date
            assert "executions" in result

    def test_list_executions_with_to_date_filter(self) -> None:
        """Test that list_executions with to_date filter works."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            # Create an execution
            execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

            # List with to_date in the future
            future_date = datetime(2030, 1, 1, tzinfo=UTC)
            result = execution_service.list_executions(to_date=future_date)

            assert result is not None
            assert "executions" in result

    def test_list_executions_from_date_excludes_earlier_started_at(self) -> None:
        """from_date strictly later than started_at excludes the execution."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._clear_storage()
        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "t"}
        ):
            created = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

        # from_date one full day after the execution's started_at.
        started_dt = datetime.fromisoformat(created["started_at"].replace("Z", "+00:00"))
        later_bound = started_dt.replace(microsecond=0) + __import__("datetime").timedelta(days=1)
        result = execution_service.list_executions(from_date=later_bound)

        ids = [e["id"] for e in result["executions"]]
        assert created["id"] not in ids

    def test_list_executions_from_date_inclusive_at_boundary(self) -> None:
        """from_date exactly equal to started_at includes the execution."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._clear_storage()
        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "t"}
        ):
            created = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

        started_dt = datetime.fromisoformat(created["started_at"].replace("Z", "+00:00"))
        result = execution_service.list_executions(from_date=started_dt)
        ids = [e["id"] for e in result["executions"]]
        assert created["id"] in ids

    def test_list_executions_to_date_excludes_later_started_at(self) -> None:
        """to_date strictly earlier than started_at excludes the execution."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._clear_storage()
        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "t"}
        ):
            created = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

        started_dt = datetime.fromisoformat(created["started_at"].replace("Z", "+00:00"))
        earlier_bound = started_dt - __import__("datetime").timedelta(days=1)
        result = execution_service.list_executions(to_date=earlier_bound)
        ids = [e["id"] for e in result["executions"]]
        assert created["id"] not in ids

    def test_list_executions_to_date_inclusive_at_boundary(self) -> None:
        """to_date exactly equal to started_at includes the execution."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._clear_storage()
        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "t"}
        ):
            created = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

        started_dt = datetime.fromisoformat(created["started_at"].replace("Z", "+00:00"))
        result = execution_service.list_executions(to_date=started_dt)
        ids = [e["id"] for e in result["executions"]]
        assert created["id"] in ids

    def test_list_executions_from_and_to_narrow_window_includes_only_matching(
        self,
    ) -> None:
        """Combined from_date + to_date narrows to the intended window."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._clear_storage()
        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "t"}
        ):
            created = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

        started_dt = datetime.fromisoformat(created["started_at"].replace("Z", "+00:00"))
        one_sec = __import__("datetime").timedelta(seconds=1)
        result = execution_service.list_executions(
            from_date=started_dt - one_sec,
            to_date=started_dt + one_sec,
        )
        ids = [e["id"] for e in result["executions"]]
        assert created["id"] in ids

    def test_get_execution_statistics_with_from_date_filter(self) -> None:
        """Test that get_execution_statistics with from_date filter works."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            # Create an execution
            execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

            # Get statistics with from_date in the past
            past_date = datetime(2020, 1, 1, tzinfo=UTC)
            result = execution_service.get_execution_statistics(from_date=past_date)

            assert result is not None
            assert "total_executions" in result

    def test_get_execution_statistics_with_to_date_filter(self) -> None:
        """Test that get_execution_statistics with to_date filter works."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test"}
        ):
            # Create an execution
            execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

            # Get statistics with to_date in the future
            future_date = datetime(2030, 1, 1, tzinfo=UTC)
            result = execution_service.get_execution_statistics(to_date=future_date)

            assert result is not None
            assert "total_executions" in result


class TestDeleteExecution:
    """Test suite for delete_execution service function."""

    def test_delete_execution_returns_false_when_not_found(self) -> None:
        """Test that delete_execution returns False for non-existent execution."""
        from wavecore.api.services.executions import service as execution_service

        non_existent_id = str(uuid.uuid4())
        result = execution_service.delete_execution(non_existent_id)

        assert result is False

    def test_delete_execution_returns_true_for_passed_execution(self) -> None:
        """Test that delete_execution returns True for passed execution."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        # Create an execution
        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test-1"}
        ):
            execution = execution_service.start_execution(
                entity_type="test",
                entity_id=entity_id,
                environment_id=TEST_ENV_ID,
            )
            execution_id = execution["id"]

        # Move to running first, then stop (changes to passed)
        _exec_storage._update_execution_status(execution_id, "running")
        execution_service.stop_execution(execution_id)

        # Now delete it
        result = execution_service.delete_execution(execution_id)

        assert result is True
        # Verify it's gone
        assert execution_service.get_execution(execution_id) is None

    def test_delete_execution_returns_true_for_failed_execution(self) -> None:
        """Test that delete_execution returns True for failed execution."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        # Create and manually set to failed state
        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test-1"}
        ):
            execution = execution_service.start_execution(
                entity_type="test",
                entity_id=entity_id,
                environment_id=TEST_ENV_ID,
            )
            execution_id = execution["id"]

        # Manually update to failed state
        _exec_storage._update_execution_status(execution_id, "failed")

        # Now delete it
        result = execution_service.delete_execution(execution_id)

        assert result is True
        assert execution_service.get_execution(execution_id) is None

    def test_delete_execution_returns_true_for_stopped_execution(self) -> None:
        """Test that delete_execution returns True for stopped execution."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        # Create an execution
        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test-1"}
        ):
            execution = execution_service.start_execution(
                entity_type="test",
                entity_id=entity_id,
                environment_id=TEST_ENV_ID,
            )
            execution_id = execution["id"]

        # Stop it (stop is the only path)
        _exec_storage._update_execution_status(execution_id, "running")
        execution_service.stop_execution(execution_id)

        # Now delete it
        result = execution_service.delete_execution(execution_id)

        assert result is True
        assert execution_service.get_execution(execution_id) is None

    def test_delete_execution_raises_for_running_execution(self) -> None:
        """Test that delete_execution raises ValueError for running execution."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        # Create an execution
        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test-1"}
        ):
            execution = execution_service.start_execution(
                entity_type="test",
                entity_id=entity_id,
                environment_id=TEST_ENV_ID,
            )
            execution_id = execution["id"]

        # Set to running state
        _exec_storage._update_execution_status(execution_id, "running")

        # Try to delete running execution - should raise
        with pytest.raises(ConflictException) as exc_info:
            execution_service.delete_execution(execution_id)

        assert "running" in str(exc_info.value)

    def test_delete_execution_raises_for_paused_execution(self) -> None:
        """Test that delete_execution raises ValueError for paused execution."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        # Create an execution
        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "test-1"}
        ):
            execution = execution_service.start_execution(
                entity_type="test",
                entity_id=entity_id,
                environment_id=TEST_ENV_ID,
            )
            execution_id = execution["id"]

        # Set to running, then pause
        _exec_storage._update_execution_status(execution_id, "running")
        execution_service.pause_execution(execution_id)

        # Try to delete paused execution - should raise
        with pytest.raises(ConflictException) as exc_info:
            execution_service.delete_execution(execution_id)

        assert "paused" in str(exc_info.value)

    def test_delete_execution_removes_all_related_data(self) -> None:
        """``delete_execution`` clears the runtime/variables caches AND
        tears down the on-disk execution directory (including logs/ and
        snapshots/ subtrees)."""
        from wavecore.api.services.executions import _storage as store
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())
        with patch.object(
            execution_service,
            "_get_entity",
            return_value={"id": entity_id, "name": "test-1", "workflow": None},
        ):
            execution = execution_service.start_execution(
                entity_type="test",
                entity_id=entity_id,
                environment_id=TEST_ENV_ID,
            )
            execution_id = execution["id"]

        store._update_execution_status(execution_id, "running")
        execution_service.stop_execution(execution_id)

        assert execution_service.get_execution(execution_id) is not None

        assert execution_service.delete_execution(execution_id) is True
        assert execution_service.get_execution(execution_id) is None
        assert execution_id not in store._runtime_state
        assert not store._get_execution_dir(execution_id).exists()


class TestGetEntityServiceWiring:
    """Test suite for _get_entity() wiring to test/suite/regression services.

    These tests verify that _get_entity() correctly routes entity lookups
    to the appropriate service (test_service, suite_service, regression_service)
    based on entity_type parameter.
    """

    def test_get_entity_calls_test_service_for_test_type(self) -> None:
        """Test that _get_entity('test', id) calls test_service.get_test()."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.tests import service as test_service

        # Create a test to lookup
        test_service._clear_storage()
        test_data = {
            "name": "My Test",
            "description": "Test description",
        }
        created_test = test_service.create_test(test_data)
        test_id = created_test["id"]

        # Call _get_entity
        result = _exec_storage._get_entity("test", test_id)

        # Should return the test
        assert result is not None
        assert result["id"] == test_id
        assert result["name"] == "My Test"

    def test_get_entity_calls_suite_service_for_suite_type(self) -> None:
        """Test that _get_entity('suite', id) calls suite_service.get_suite()."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.suites import _storage as _suite_storage
        from wavecore.api.services.suites import service as suite_service

        # Create a suite to lookup
        _suite_storage._clear_storage()
        suite_data = {
            "name": "My Suite",
            "description": "Suite description",
        }
        created_suite = suite_service.create_suite(suite_data)
        suite_id = created_suite["id"]

        # Call _get_entity
        result = _exec_storage._get_entity("suite", suite_id)

        # Should return the suite
        assert result is not None
        assert result["id"] == suite_id
        assert result["name"] == "My Suite"

    def test_get_entity_calls_regression_service_for_regression_type(self) -> None:
        """Test that _get_entity('regression', id) calls regression_service.get_regression()."""
        from tests.api.regression_test_helpers import clear_regression_storage
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.regressions import service as regression_service

        # Create a regression to lookup
        clear_regression_storage()
        regression_data = {
            "name": "My Regression",
            "description": "Regression description",
        }
        created_regression = regression_service.create_regression(regression_data)
        regression_id = created_regression["id"]

        # Call _get_entity
        result = _exec_storage._get_entity("regression", regression_id)

        # Should return the regression
        assert result is not None
        assert result["id"] == regression_id
        assert result["name"] == "My Regression"

    def test_get_entity_returns_none_for_nonexistent_test(self) -> None:
        """Test that _get_entity returns None for non-existent test ID."""
        from wavecore.api.services.executions import _storage as _exec_storage

        nonexistent_id = str(uuid.uuid4())
        result = _exec_storage._get_entity("test", nonexistent_id)

        assert result is None

    def test_get_entity_returns_none_for_nonexistent_suite(self) -> None:
        """Test that _get_entity returns None for non-existent suite ID."""
        from wavecore.api.services.executions import _storage as _exec_storage

        nonexistent_id = str(uuid.uuid4())
        result = _exec_storage._get_entity("suite", nonexistent_id)

        assert result is None

    def test_get_entity_returns_none_for_nonexistent_regression(self) -> None:
        """Test that _get_entity returns None for non-existent regression ID."""
        from wavecore.api.services.executions import _storage as _exec_storage

        nonexistent_id = str(uuid.uuid4())
        result = _exec_storage._get_entity("regression", nonexistent_id)

        assert result is None

    def test_get_entity_returns_none_for_invalid_type(self) -> None:
        """Test that _get_entity returns None for invalid entity type."""
        from wavecore.api.services.executions import _storage as _exec_storage

        result = _exec_storage._get_entity("invalid_type", str(uuid.uuid4()))

        assert result is None

    def test_start_execution_works_with_real_test(self) -> None:
        """Test that start_execution works with an actual test entity."""
        from wavecore.api.services.executions import service as execution_service
        from wavecore.api.services.tests import service as test_service

        # Create a real test
        test_service._clear_storage()
        test_data = {
            "name": "Executable Test",
            "description": "A test that can be executed",
        }
        created_test = test_service.create_test(test_data)
        test_id = created_test["id"]

        # Start execution - should NOT need mocking
        result = execution_service.start_execution(
            entity_type="test",
            entity_id=test_id,
            environment_id=TEST_ENV_ID,
        )

        assert result is not None
        assert result["entity_type"] == "test"
        assert result["entity_id"] == test_id
        assert result["status"] == "running"

    def test_start_execution_works_with_real_suite(self) -> None:
        """Test that start_execution works with an actual suite entity."""
        from wavecore.api.services.executions import service as execution_service
        from wavecore.api.services.suites import _storage as _suite_storage
        from wavecore.api.services.suites import service as suite_service

        # Create a real suite
        _suite_storage._clear_storage()
        suite_data = {
            "name": "Executable Suite",
            "description": "A suite that can be executed",
            "tests": make_test_ids(1),
        }
        created_suite = suite_service.create_suite(suite_data)
        suite_id = created_suite["id"]

        # Start execution - should NOT need mocking
        result = execution_service.start_execution(
            entity_type="suite",
            entity_id=suite_id,
            environment_id=TEST_ENV_ID,
        )

        assert result is not None
        assert result["entity_type"] == "suite"
        assert result["entity_id"] == suite_id
        assert result["status"] == "running"

    def test_start_execution_works_with_real_regression(self) -> None:
        """Test that start_execution works with an actual regression entity."""
        from tests.api.regression_test_helpers import clear_regression_storage
        from wavecore.api.services.executions import service as execution_service
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        # Create a real regression over a real suite (membership is existence-checked)
        clear_regression_storage()
        member_suite = suite_service.create_suite(
            {"name": "Regression Member Suite", "tests": make_test_ids(1)}
        )
        regression_data = {
            "name": "Executable Regression",
            "description": "A regression that can be executed",
            "suites": [member_suite["id"]],
        }
        created_regression = regression_service.create_regression(regression_data)
        regression_id = created_regression["id"]

        # Start execution - should NOT need mocking
        result = execution_service.start_execution(
            entity_type="regression",
            entity_id=regression_id,
            environment_id=TEST_ENV_ID,
        )

        assert result is not None
        assert result["entity_type"] == "regression"
        assert result["entity_id"] == regression_id
        assert result["status"] == "running"

    def test_start_execution_fails_for_nonexistent_entity(self) -> None:
        """Test that start_execution raises LookupError for non-existent entity."""
        from wavecore.api.services.executions import service as execution_service

        nonexistent_id = str(uuid.uuid4())

        with pytest.raises(LookupError, match=r"not found"):
            execution_service.start_execution(
                entity_type="test",
                entity_id=nonexistent_id,
                environment_id=TEST_ENV_ID,
            )

    def test_start_execution_rejects_test_with_fatal_validation_errors(self) -> None:
        """Test that start_execution raises ValueError for test with fatal errors."""
        from wavecore.api.services.executions import service as execution_service
        from wavecore.api.services.tests import service as test_service

        # Create a test with invalid workflow (None triggers MISSING_WORKFLOW fatal)
        test_service._clear_storage()
        created = test_service.create_test({"name": "Fatal Validation Test"})
        test_id = created["id"]
        test_service._update_raw_test(test_id, {"workflow": "not-a-dict"})

        with pytest.raises(ValidationException, match=r"fatal validation errors"):
            execution_service.start_execution(
                entity_type="test",
                entity_id=test_id,
                environment_id=TEST_ENV_ID,
            )

    def test_start_execution_rejects_test_with_validation_errors(self) -> None:
        """Test that start_execution raises ValueError for test with non-fatal errors."""
        from wavecore.api.services.executions import service as execution_service
        from wavecore.api.services.tests import service as test_service

        # Create a clean test, then inject an invalid variable name post-create.
        # The create_test pipeline auto-fixes INVALID_VARIABLE, so this data
        # must be planted directly via _update_raw_test.
        test_service._clear_storage()
        created = test_service.create_test({"name": "Invalid Var Execution Test"})
        test_id = created["id"]
        test_service._update_raw_test(
            test_id,
            {"variables": {"123-bad": {"type": "string", "value": "test"}}},
        )

        with pytest.raises(ValidationException, match=r"validation errors"):
            execution_service.start_execution(
                entity_type="test",
                entity_id=test_id,
                environment_id=TEST_ENV_ID,
            )

    def test_start_execution_rejects_test_with_required_param_missing(self) -> None:
        """Test that REQUIRED_PARAM_MISSING blocks execution."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        # Mock entity lookup and validation to simulate blocking validation errors

        with (
            patch.object(
                execution_service,
                "_get_entity",
                return_value={"id": entity_id, "name": "test-1"},
            ),
            patch.object(
                _exec_storage,
                "_validate_entity",
                return_value={
                    "fatal": False,
                    "errors": [
                        {
                            "code": "REQUIRED_PARAM_MISSING",
                            "message": "Required parameter 'url' is missing",
                        }
                    ],
                    "warnings": [],
                },
            ),
        ):
            with pytest.raises(ValidationException, match=r"validation errors"):
                execution_service.start_execution(
                    entity_type="test",
                    entity_id=entity_id,
                    environment_id=TEST_ENV_ID,
                )

    def test_start_execution_skips_validation_for_non_test_types(self) -> None:
        """Test that validation is skipped for suite/regression entity types."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        # Suite and regression should skip test-level validation
        entity = {
            "id": entity_id,
            "name": "entity-1",
            "tests": ["test-1"],
            "suites": ["suite-1"],
        }

        for entity_type in ["suite", "regression"]:
            with patch.object(
                execution_service,
                "_get_entity",
                return_value=entity,
            ):
                result = execution_service.start_execution(
                    entity_type=entity_type,
                    entity_id=entity_id,
                    environment_id=TEST_ENV_ID,
                )
                assert result["status"] == "running"


# ============================================================================
# Item 8 - Workbench Tracked Execution Viewer
# start_execution delegates to workbench engine (session_id = execution_id)
# terminal bridge updates execution record on workbench terminal event
# stop_execution routes through workbench stop
# workbench session_data carries execution_id for tracked sessions
# 409 Conflict when another session is active; message references both kinds
# ============================================================================


class TestStartExecutionWorkbenchIntegration:
    """start_execution delegates to the workbench engine."""

    def test_start_execution_invokes_start_workbench_run_with_session_id_equal_to_execution_id(
        self,
    ) -> None:
        """start_execution must invoke workbench_service.start_workbench_run
        with session_id == execution_id so the workbench session IS the tracked execution."""
        from wavecore.api.services.executions import service as execution_service
        from wavecore.api.services.workbench import service as workbench_service

        entity_id = str(uuid.uuid4())
        entity = {
            "id": entity_id,
            "name": "test-workflow",
            "workflow": {"nodes": [], "edges": []},
        }

        with patch.object(execution_service, "_get_entity", return_value=entity):
            with patch.object(workbench_service, "start_workbench_run") as mock_start:
                mock_start.return_value = {"session_id": "placeholder", "status": "running"}

                created = execution_service.start_execution(
                    entity_type="test",
                    entity_id=entity_id,
                    environment_id=TEST_ENV_ID,
                )

                mock_start.assert_called_once()
                call_kwargs = mock_start.call_args.kwargs
                assert (
                    call_kwargs.get("session_id") == created["id"]
                ), "start_execution must pass session_id=execution_id to start_workbench_run"
                assert call_kwargs.get("test_id") == entity_id
                assert call_kwargs.get("environment_id") == TEST_ENV_ID

    def test_start_execution_refuses_a_suite_with_no_tests(self) -> None:
        """A suite with nothing in it cannot verify anything, so it must not run green."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())
        entity = {"id": entity_id, "name": "empty-suite", "tests": []}

        with patch.object(execution_service, "_get_entity", return_value=entity):
            with pytest.raises(
                ValidationException,
                match=r"^Cannot start execution: suite must reference at least one test$",
            ):
                execution_service.start_execution(
                    entity_type="suite",
                    entity_id=entity_id,
                    environment_id=TEST_ENV_ID,
                )

    def test_start_execution_refuses_a_regression_with_no_suites(self) -> None:
        """Same rule one level up: an empty regression is a vacuous green."""
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())
        entity = {"id": entity_id, "name": "empty-regression", "suites": []}

        with patch.object(execution_service, "_get_entity", return_value=entity):
            with pytest.raises(
                ValidationException,
                match=r"^Cannot start execution: regression must reference at least one suite$",
            ):
                execution_service.start_execution(
                    entity_type="regression",
                    entity_id=entity_id,
                    environment_id=TEST_ENV_ID,
                )

    def test_start_execution_hands_variable_overrides_to_the_runner(self) -> None:
        """Per-run variables must reach the run, not just the execution record."""
        from wavecore.api.services.executions import service as execution_service
        from wavecore.api.services.workbench import service as workbench_service

        entity_id = str(uuid.uuid4())
        entity = {
            "id": entity_id,
            "name": "test-workflow",
            "workflow": {"nodes": [], "edges": []},
        }

        with patch.object(execution_service, "_get_entity", return_value=entity):
            with patch.object(workbench_service, "start_workbench_run") as mock_start:
                mock_start.return_value = {"session_id": "placeholder", "status": "running"}

                execution_service.start_execution(
                    entity_type="test",
                    entity_id=entity_id,
                    environment_id=TEST_ENV_ID,
                    variables={"expected_status": 599},
                )

                assert mock_start.call_args.kwargs.get("overrides") == {"expected_status": 599}

    def test_start_execution_passes_execution_id_to_workbench_session(self) -> None:
        """The tracked workbench session must carry execution_id for the frontend indicator."""
        from wavecore.api.services.executions import service as execution_service
        from wavecore.api.services.workbench import service as workbench_service

        entity_id = str(uuid.uuid4())
        entity = {
            "id": entity_id,
            "name": "test-workflow",
            "workflow": {"nodes": [], "edges": []},
        }

        with patch.object(execution_service, "_get_entity", return_value=entity):
            with patch.object(workbench_service, "start_workbench_run") as mock_start:
                mock_start.return_value = {"session_id": "placeholder", "status": "running"}

                created = execution_service.start_execution(
                    entity_type="test",
                    entity_id=entity_id,
                    environment_id=TEST_ENV_ID,
                )

                lineage = mock_start.call_args.kwargs.get("lineage")
                assert lineage is not None and lineage.execution_id == created["id"], (
                    "start_execution must forward execution_id to workbench (via RunLineage) so "
                    "session_data records the tracked-execution linkage"
                )

    def test_start_execution_conflict_message_names_both_session_kinds(self) -> None:
        """The conflict error must name both kinds of sessions (workbench and tracked)."""
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.executions import service as execution_service
        from wavecore.api.services.workbench import service as workbench_service

        entity_id = str(uuid.uuid4())
        entity = {
            "id": entity_id,
            "name": "test-workflow",
            "workflow": {"nodes": [], "edges": []},
        }

        def raise_conflict(**kwargs: Any) -> dict[str, Any]:
            raise ConflictException(
                "Cannot start: another session is already active (workbench or tracked execution)"
            )

        with patch.object(execution_service, "_get_entity", return_value=entity):
            with patch.object(workbench_service, "start_workbench_run", side_effect=raise_conflict):
                with pytest.raises(ConflictException) as exc_info:
                    execution_service.start_execution(
                        entity_type="test",
                        entity_id=entity_id,
                        environment_id=TEST_ENV_ID,
                    )

                message = str(exc_info.value).lower()
                assert (
                    "workbench" in message or "tracked" in message
                ), "Conflict error must identify the session kinds"


class TestExecutionTerminalBridge:
    """Terminal engine events update the execution record."""

    def test_terminal_bridge_transitions_execution_to_passed(self) -> None:
        """Workbench terminal event `passed` updates execution record to status=passed +
        ended_at.
        """
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "t1"}
        ):
            with patch(
                "wavecore.api.services.workbench.service.start_workbench_run",
                return_value={"session_id": "p", "status": "running"},
            ):
                created = execution_service.start_execution(
                    entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
                )

        # The bridge must expose a handler that the workbench calls on terminal states.
        assert hasattr(
            execution_service, "_on_workbench_session_terminated"
        ), "executions service must expose a terminal-state bridge handler"

        execution_service._on_workbench_session_terminated(created["id"], "passed")

        record = _exec_storage._execution_storage[created["id"]]
        assert record["status"] == "passed"
        assert "ended_at" in record

    def test_terminal_bridge_transitions_execution_to_failed(self) -> None:
        """Workbench terminal event `failed` updates execution record to status=failed."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "t1"}
        ):
            with patch(
                "wavecore.api.services.workbench.service.start_workbench_run",
                return_value={"session_id": "p", "status": "running"},
            ):
                created = execution_service.start_execution(
                    entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
                )

        execution_service._on_workbench_session_terminated(created["id"], "failed")

        record = _exec_storage._execution_storage[created["id"]]
        assert record["status"] == "failed"
        assert "ended_at" in record

    def test_terminal_bridge_transitions_execution_to_stopped(self) -> None:
        """: workbench terminal event `stopped` updates execution record to status=stopped."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "t1"}
        ):
            with patch(
                "wavecore.api.services.workbench.service.start_workbench_run",
                return_value={"session_id": "p", "status": "running"},
            ):
                created = execution_service.start_execution(
                    entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
                )

        execution_service._on_workbench_session_terminated(created["id"], "stopped")

        record = _exec_storage._execution_storage[created["id"]]
        assert record["status"] == "stopped"
        assert "ended_at" in record

    def test_terminal_bridge_swallows_snapshot_save_exception(self) -> None:
        """Layered defense: if ``_save_snapshot`` still raises despite the
        ``_yaml_safe`` boundary, the terminal callback must log and
        continue so the status update and variable persistence still land.
        """
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())
        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "t"}
        ):
            with patch(
                "wavecore.api.services.workbench.service.start_workbench_run",
                return_value={"session_id": "p", "status": "running"},
            ):
                created = execution_service.start_execution(
                    entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
                )

        with patch(
            "wavecore.api.services.executions._storage._save_snapshot",
            side_effect=RuntimeError("disk full"),
        ):
            execution_service._on_workbench_session_terminated(created["id"], "passed")

        record = _exec_storage._execution_storage[created["id"]]
        assert record["status"] == "passed"
        assert "ended_at" in record

    def test_terminal_bridge_swallows_variables_save_exception(self) -> None:
        """Same guarantee for ``_save_variables`` - a disk error persisting
        variables must not stall the terminal status transition.
        """
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())
        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "t"}
        ):
            with patch(
                "wavecore.api.services.workbench.service.start_workbench_run",
                return_value={"session_id": "p", "status": "running"},
            ):
                created = execution_service.start_execution(
                    entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
                )

        with patch(
            "wavecore.api.services.workbench._common.get_session_snapshot",
            return_value={"variables": {"x": 1}, "block_states": {}},
        ):
            with patch(
                "wavecore.api.services.executions.service._save_variables",
                side_effect=RuntimeError("disk full"),
            ):
                execution_service._on_workbench_session_terminated(created["id"], "passed")

        record = _exec_storage._execution_storage[created["id"]]
        assert record["status"] == "passed"
        assert "ended_at" in record

    def test_terminal_bridge_transitions_even_when_variable_persist_fails(
        self,
    ) -> None:
        """Architectural invariant: a user plugin returning a value that
        YAML cannot serialize must never stall the terminal state
        transition. The status update runs apart from the best-effort
        variable/snapshot persistence.
        """
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        # A plain `str` subclass reproduces the exact yaml RepresenterError
        # that lxml's `_ElementUnicodeResult` causes, without pulling lxml
        # into the test dependency graph.
        class LxmlLikeStr(str):
            pass

        entity_id = str(uuid.uuid4())
        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "t"}
        ):
            with patch(
                "wavecore.api.services.workbench.service.start_workbench_run",
                return_value={"session_id": "p", "status": "running"},
            ):
                created = execution_service.start_execution(
                    entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
                )

        # Inject an unsafe variable into the session snapshot that the
        # terminal callback will read via `get_session_snapshot`.
        with patch(
            "wavecore.api.services.workbench._common.get_session_snapshot",
            return_value={
                "variables": {"xml_result": LxmlLikeStr("Alpha")},
                "block_states": {},
            },
        ):
            execution_service._on_workbench_session_terminated(created["id"], "passed")

        record = _exec_storage._execution_storage[created["id"]]
        assert record["status"] == "passed", (
            "Execution must reach terminal status even when the "
            "variable snapshot write cannot be persisted"
        )
        assert "ended_at" in record

    def test_terminal_bridge_ignores_unknown_session_id(self) -> None:
        """Terminal events for session_ids that are not tracked executions are ignored."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        unknown = str(uuid.uuid4())

        # Must not raise even though no such execution exists.
        execution_service._on_workbench_session_terminated(unknown, "passed")

        assert unknown not in _exec_storage._execution_storage

    def test_terminal_bridge_no_op_for_already_terminal_execution(self) -> None:
        """Calling the bridge twice for the same execution is idempotent: once
        the record is already passed/failed/stopped, later terminal events do
        not clobber the recorded status."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())
        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "t"}
        ):
            created = execution_service.start_execution(
                entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
            )

        # First terminal event lands.
        execution_service._on_workbench_session_terminated(created["id"], "passed")
        record = _exec_storage._execution_storage[created["id"]]
        assert record["status"] == "passed"
        first_ended_at = record["ended_at"]

        # A second stray terminal event must not overwrite the recorded status.
        execution_service._on_workbench_session_terminated(created["id"], "failed")
        assert _exec_storage._execution_storage[created["id"]]["status"] == "passed"
        assert _exec_storage._execution_storage[created["id"]]["ended_at"] == first_ended_at


class TestStopExecutionRoutesThroughWorkbench:
    """stop_execution delegates to workbench stop."""

    def test_stop_execution_calls_stop_workbench_run_with_execution_id(self) -> None:
        """stop_execution must invoke
        workbench_service.stop_workbench_run(session_id=execution_id).
        """
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service
        from wavecore.api.services.workbench import service as workbench_service

        entity_id = str(uuid.uuid4())

        with patch.object(
            execution_service, "_get_entity", return_value={"id": entity_id, "name": "t1"}
        ):
            with patch.object(
                workbench_service,
                "start_workbench_run",
                return_value={"session_id": "p", "status": "running"},
            ):
                created = execution_service.start_execution(
                    entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
                )
                _exec_storage._update_execution_status(created["id"], "running")

                with patch.object(workbench_service, "stop_workbench_run") as mock_stop:
                    mock_stop.return_value = {"session_id": created["id"], "status": "stopped"}

                    execution_service.stop_execution(created["id"])

                    mock_stop.assert_called_once()
                    # Arg may be positional or keyword; accept either.
                    args = mock_stop.call_args.args
                    kwargs = mock_stop.call_args.kwargs
                    passed_id = (args[0] if args else None) or kwargs.get("session_id")
                    assert (
                        passed_id == created["id"]
                    ), "stop_execution must pass session_id=execution_id to stop_workbench_run"


class TestStartExecutionSubsetContract:
    """start_execution accepts an optional selected_tests parameter.

    For suites it is a list of test_id strings. For regressions it is a list
    of {"suite_id": str, "test_id": str} dicts. The field is persisted on
    the execution record so the frontend can re-populate the run dialog.
    """

    def _build_suite(self, test_ids: list[str]) -> str:
        from wavecore.api.services.suites import _storage as _suite_storage
        from wavecore.api.services.suites import service as suite_service

        _suite_storage._clear_storage()
        suite = suite_service.create_suite({"name": "Subset Suite", "tests": test_ids})
        return suite["id"]

    def _build_regression(self, suite_ids: list[str]) -> str:
        from tests.api.regression_test_helpers import clear_regression_storage
        from wavecore.api.services.regressions import service as regression_service

        clear_regression_storage()
        regression = regression_service.create_regression(
            {"name": "Subset Regression", "suites": suite_ids}
        )
        return regression["id"]

    def _build_test(self, name: str = "t") -> str:
        from wavecore.api.services.tests import service as test_service

        test = test_service.create_test(
            {
                "name": name,
                "workflow": {
                    "nodes": [{"id": "n1", "type": "workflowNode", "data": {}}],
                    "edges": [],
                },
            }
        )
        return test["id"]

    def test_start_execution_for_suite_accepts_selected_tests_list(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        t1 = self._build_test("t1")
        t2 = self._build_test("t2")
        suite_id = self._build_suite([t1, t2])

        result = execution_service.start_execution(
            entity_type="suite",
            entity_id=suite_id,
            environment_id=TEST_ENV_ID,
            selected_tests=[t1],
        )
        assert result["selected_tests"] == [t1]

    def test_start_execution_for_regression_accepts_selected_pairs(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        t1 = self._build_test("rt1")
        t2 = self._build_test("rt2")
        s_a = self._build_suite([t1, t2])
        reg_id = self._build_regression([s_a])

        pairs = [{"suite_id": s_a, "test_id": t1}]
        result = execution_service.start_execution(
            entity_type="regression",
            entity_id=reg_id,
            environment_id=TEST_ENV_ID,
            selected_tests=pairs,
        )
        assert result["selected_tests"] == pairs

    def test_start_execution_persists_selected_tests_on_record(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        t1 = self._build_test("pt1")
        suite_id = self._build_suite([t1])

        created = execution_service.start_execution(
            entity_type="suite",
            entity_id=suite_id,
            environment_id=TEST_ENV_ID,
            selected_tests=[t1],
        )

        loaded = execution_service.get_execution(created["id"])
        assert loaded is not None
        assert loaded["selected_tests"] == [t1]

    def test_start_execution_defaults_selected_tests_to_none_when_omitted(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        t1 = self._build_test("dt1")
        suite_id = self._build_suite([t1])

        result = execution_service.start_execution(
            entity_type="suite",
            entity_id=suite_id,
            environment_id=TEST_ENV_ID,
        )
        assert result.get("selected_tests") is None

    def test_start_execution_rejects_empty_selected_tests_for_suite(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        t1 = self._build_test("et1")
        suite_id = self._build_suite([t1])

        with pytest.raises(
            ValidationException,
            match=r"^selected_tests must contain at least one entry when provided$",
        ):
            execution_service.start_execution(
                entity_type="suite",
                entity_id=suite_id,
                environment_id=TEST_ENV_ID,
                selected_tests=[],
            )

    def test_start_execution_rejects_unknown_test_id_in_suite_subset(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        t1 = self._build_test("ut1")
        suite_id = self._build_suite([t1])
        missing = str(uuid.uuid4())

        with pytest.raises(
            ValidationException,
            match=rf"^Test '{missing}' is not part of suite '{suite_id}'$",
        ):
            execution_service.start_execution(
                entity_type="suite",
                entity_id=suite_id,
                environment_id=TEST_ENV_ID,
                selected_tests=[missing],
            )

    def test_start_execution_rejects_malformed_regression_subset_entry(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        t1 = self._build_test("mt1")
        s_a = self._build_suite([t1])
        reg_id = self._build_regression([s_a])

        with pytest.raises(
            ValidationException,
            match=(
                r"^selected_tests entries for regression must be " r"\{suite_id, test_id\} pairs$"
            ),
        ):
            execution_service.start_execution(
                entity_type="regression",
                entity_id=reg_id,
                environment_id=TEST_ENV_ID,
                selected_tests=[t1],  # wrong shape for regression
            )

    def test_start_execution_rejects_unknown_suite_in_regression_subset(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        t1 = self._build_test("xt1")
        s_a = self._build_suite([t1])
        reg_id = self._build_regression([s_a])
        missing_suite = str(uuid.uuid4())

        with pytest.raises(
            ValidationException,
            match=rf"^Suite '{missing_suite}' is not part of regression '{reg_id}'$",
        ):
            execution_service.start_execution(
                entity_type="regression",
                entity_id=reg_id,
                environment_id=TEST_ENV_ID,
                selected_tests=[{"suite_id": missing_suite, "test_id": t1}],
            )

    def test_start_execution_rejects_unknown_test_in_regression_subset(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        t1 = self._build_test("yt1")
        s_a = self._build_suite([t1])
        reg_id = self._build_regression([s_a])
        missing_test = str(uuid.uuid4())

        with pytest.raises(
            ValidationException,
            match=(
                rf"^Test '{missing_test}' is not part of suite '{s_a}' "
                rf"in regression '{reg_id}'$"
            ),
        ):
            execution_service.start_execution(
                entity_type="regression",
                entity_id=reg_id,
                environment_id=TEST_ENV_ID,
                selected_tests=[{"suite_id": s_a, "test_id": missing_test}],
            )

    def test_start_execution_rejects_selected_tests_for_test_entity_type(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())
        with patch.object(
            execution_service,
            "_get_entity",
            return_value={"id": entity_id, "name": "test-1"},
        ):
            with pytest.raises(
                ValidationException,
                match=r"^selected_tests is only valid for suite or regression entities$",
            ):
                execution_service.start_execution(
                    entity_type="test",
                    entity_id=entity_id,
                    environment_id=TEST_ENV_ID,
                    selected_tests=["anything"],
                )

    def test_start_execution_rejects_non_string_entry_in_suite_subset(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        t1 = self._build_test("nst1")
        suite_id = self._build_suite([t1])

        with pytest.raises(
            ValidationException,
            match=r"^selected_tests entries for suite must be test_id strings$",
        ):
            execution_service.start_execution(
                entity_type="suite",
                entity_id=suite_id,
                environment_id=TEST_ENV_ID,
                selected_tests=[{"unexpected": "shape"}],  # type: ignore[list-item]
            )

    def test_start_execution_skips_missing_suite_when_seeding_regression_timeline(self) -> None:
        """If a suite referenced by a regression is no longer resolvable, the
        orchestrator's timeline seeder silently skips it rather than crashing.
        """
        from wavecore.api.services.executions import service as execution_service
        from wavecore.api.services.suites import service as suite_service

        t1 = self._build_test("miss-t1")
        s_a = self._build_suite([t1])
        reg_id = self._build_regression([s_a])

        real_get_suite = suite_service.get_suite

        def _missing_suite(sid: str) -> Any:
            if sid == s_a:
                return None
            return real_get_suite(sid)

        with patch.object(suite_service, "get_suite", side_effect=_missing_suite):
            result = execution_service.start_execution(
                entity_type="regression",
                entity_id=reg_id,
                environment_id=TEST_ENV_ID,
            )

        # The regression still starts without crashing; the missing suite
        # contributes no timeline entries because the seeder `continue`s
        # past it rather than raising.
        assert result["status"] == "running"


class TestExecutionServiceHelpers:
    """Cover service-level helpers: progress, row-building, aggregation,
    enrichment, and export internals."""

    def test_compute_progress_returns_zeros_for_none_state(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        assert execution_service._compute_progress(None) == {
            "current": 0,
            "total": 1,
            "percentage": 0.0,
        }

    def test_compute_progress_returns_zeros_when_all_excluded(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        state = {"runs": {"r1": {"status": "excluded"}, "r2": {"status": "excluded"}}}
        assert execution_service._compute_progress(state) == {
            "current": 0,
            "total": 1,
            "percentage": 0.0,
        }

    def test_compute_progress_counts_terminal_runs(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        state = {
            "runs": {
                "r1": {"status": "passed"},
                "r2": {"status": "running"},
                "r3": {"status": "excluded"},
            }
        }
        result = execution_service._compute_progress(state)
        assert result["current"] == 1
        assert result["total"] == 2

    def test_run_row_no_entity_defaults_empty_tags(self) -> None:
        from datetime import UTC, datetime

        from wavecore.api.services.executions import service as execution_service

        row = execution_service._run_row(
            "t1", "r1", {"status": "passed", "duration": 1.25}, None, datetime.now(UTC)
        )
        assert row["tags"] == []
        assert row["name"] == ""

    def test_run_row_pending_when_run_state_missing(self) -> None:
        from datetime import UTC, datetime

        from wavecore.api.services.executions import service as execution_service

        row = execution_service._run_row(
            "t1",
            "r1",
            None,
            {"name": "T", "tags": ["slow"]},
            datetime.now(UTC),
        )
        assert row["status"] == "pending"
        assert row["tags"] == ["slow"]
        assert row["duration"] is None

    def test_run_row_running_computes_live_duration(self) -> None:
        from datetime import UTC, datetime

        from wavecore.api.services.executions import service as execution_service

        now = datetime(2026, 4, 22, 0, 0, 30, tzinfo=UTC)
        row = execution_service._run_row(
            "t1",
            "r1",
            {
                "status": "running",
                "duration": None,
                "started_at": "2026-04-22T00:00:00+00:00",
            },
            {"name": "T"},
            now,
        )
        assert row["status"] == "running"
        assert row["duration"] is not None

    def test_aggregate_suite_status_matches_each_branch(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        s = execution_service._aggregate_suite_status
        assert s([]) == "pending"
        assert s([{"status": "stopped"}, {"status": "passed"}]) == "stopped"
        assert s([{"status": "failed"}, {"status": "passed"}]) == "failed"
        assert s([{"status": "running"}, {"status": "passed"}]) == "running"
        assert s([{"status": "pending"}, {"status": "passed"}]) == "running"
        assert s([{"status": "passed"}, {"status": "passed"}]) == "passed"

    def test_resolve_environment_returns_none_for_blank_id(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        assert execution_service._resolve_environment(None) is None
        assert execution_service._resolve_environment("") is None

    def test_compute_counts_merges_flat_and_suites(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        counts = execution_service._compute_counts(
            [{"status": "passed"}, {"status": "failed"}],
            [{"tests": [{"status": "skipped"}, {"status": "excluded"}]}],
        )
        assert counts["total"] == 4
        assert counts["passed"] == 1
        assert counts["failed"] == 1
        assert counts["skipped"] == 1
        assert counts["excluded"] == 1

    def test_slugify_execution_name_falls_back_when_empty(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        assert execution_service._slugify_execution_name("") == "execution"
        assert execution_service._slugify_execution_name("  ") == "execution"
        assert execution_service._slugify_execution_name("My Run #1!") == "My-Run-1"

    def test_assemble_test_slice_pending_returns_minimal_record(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        slice_ = execution_service._assemble_test_slice(
            "exec-1",
            {"id": "t1", "name": "T", "status": "pending", "run_id": "r1"},
        )
        assert slice_ == {"id": "t1", "name": "T", "status": "pending"}

    def test_select_export_tests_returns_all_when_filter_none(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        execution = {
            "tests": [{"id": "t1", "status": "passed"}],
            "suites": [{"tests": [{"id": "t2", "status": "passed"}]}],
        }
        selected = execution_service._select_export_tests(execution, None)
        assert [t["id"] for t in selected] == ["t1", "t2"]

    def test_select_export_tests_filters_by_id_and_raises_on_missing(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        execution = {"tests": [{"id": "t1", "status": "passed"}]}
        assert execution_service._select_export_tests(execution, ["t1"])[0]["id"] == "t1"
        with pytest.raises(NotFoundException):
            execution_service._select_export_tests(execution, ["missing"])

    def test_format_cursor_encodes_child_seq_as_x_when_none(self) -> None:
        from wavecore.api.services.executions import service as execution_service

        assert execution_service._format_cursor(None) is None
        assert execution_service._format_cursor((3, None)) == "3:x"
        assert execution_service._format_cursor((3, 7)) == "3:7"


class TestPaginateExecutionLogs:
    def test_returns_none_for_unknown_execution(self) -> None:
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._clear_storage()
        assert execution_service.paginate_execution_logs(str(uuid.uuid4()), None, 10) is None

    def test_returns_empty_entries_for_known_execution_without_logs(self) -> None:
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._clear_storage()
        exec_id = str(uuid.uuid4())
        _exec_storage._execution_storage[exec_id] = {"id": exec_id}
        result = execution_service.paginate_execution_logs(exec_id, None, 10)
        assert result == {"entries": [], "prev_cursor": None}

    def test_returns_run_logs_for_a_test_execution_without_chronology(self) -> None:
        """A test-type execution writes no logs.yaml; the cover-sheet run_id
        still resolves its per-run log file."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._clear_storage()
        exec_id = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        _exec_storage._execution_storage[exec_id] = {"id": exec_id, "run_id": run_id}
        for index in range(3):
            _exec_storage._append_log(
                exec_id, run_id, {"level": "INFO", "message": f"line-{index}"}
            )

        result = execution_service.paginate_execution_logs(exec_id, None, 10)
        assert result is not None
        messages = [entry["message"] for entry in result["entries"]]
        assert messages == ["line-0", "line-1", "line-2"]
        assert all(entry["run_id"] == run_id for entry in result["entries"])
        assert result["prev_cursor"] is None

    def test_paginates_a_test_execution_without_chronology(self) -> None:
        """The cursor walks a single-run chronology backwards page by page."""
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._clear_storage()
        exec_id = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        _exec_storage._execution_storage[exec_id] = {"id": exec_id, "run_id": run_id}
        for index in range(5):
            _exec_storage._append_log(
                exec_id, run_id, {"level": "INFO", "message": f"line-{index}"}
            )

        def as_cursor(formatted: str) -> tuple[int, int | None]:
            """Wire cursor back to the tuple the service takes (route parity)."""
            idx_part, child_part = formatted.rsplit(":", 1)
            return int(idx_part), None if child_part == "x" else int(child_part)

        newest = execution_service.paginate_execution_logs(exec_id, None, 2)
        assert newest is not None
        assert [e["message"] for e in newest["entries"]] == ["line-3", "line-4"]
        assert newest["prev_cursor"] is not None

        older = execution_service.paginate_execution_logs(
            exec_id, as_cursor(newest["prev_cursor"]), 2
        )
        assert older is not None
        assert [e["message"] for e in older["entries"]] == ["line-1", "line-2"]

        oldest = execution_service.paginate_execution_logs(
            exec_id, as_cursor(older["prev_cursor"]), 2
        )
        assert oldest is not None
        assert [e["message"] for e in oldest["entries"]] == ["line-0"]
        assert oldest["prev_cursor"] is None


class TestExportExecutionService:
    """Service-level export flow (no HTTP)."""

    def test_export_returns_none_for_unknown_execution(self) -> None:
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._clear_storage()
        assert execution_service.export_execution(str(uuid.uuid4()), None, "json") is None

    def test_export_execution_signature_has_no_secrets_param(self) -> None:
        import inspect

        from wavecore.api.services.executions import service as execution_service

        params = set(inspect.signature(execution_service.export_execution).parameters)
        assert "mask_secrets" not in params
        assert "secrets" not in params

    def test_export_json_payload_for_running_test_execution(self) -> None:
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._clear_storage()
        entity_id = str(uuid.uuid4())
        with patch.object(
            execution_service,
            "_get_entity",
            return_value={"id": entity_id, "name": "ExportMe"},
        ):
            created = execution_service.start_execution(
                entity_type="test",
                entity_id=entity_id,
                environment_id=TEST_ENV_ID,
            )

        result = execution_service.export_execution(created["id"], None, "json")
        assert result is not None
        content, filename = result
        assert filename.endswith(".json")
        import json as _json

        data = _json.loads(content)
        assert data["id"] == created["id"]
        assert data["entity_id"] == entity_id

    def test_export_yaml_payload_includes_tests_key(self) -> None:
        import yaml as _yaml

        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._clear_storage()
        entity_id = str(uuid.uuid4())
        with patch.object(
            execution_service,
            "_get_entity",
            return_value={"id": entity_id, "name": "YAMLRun"},
        ):
            created = execution_service.start_execution(
                entity_type="test",
                entity_id=entity_id,
                environment_id=TEST_ENV_ID,
            )

        result = execution_service.export_execution(created["id"], None, "yaml")
        assert result is not None
        content, filename = result
        assert filename.endswith(".yaml")
        data = _yaml.safe_load(content)
        assert "tests" in data


class TestOnWorkbenchSessionTerminatedHelpers:
    """Cover the test-type workbench terminal callback for non-trivial
    branches (snapshot persistence, variables, duration, etc.)."""

    def test_callback_noop_when_execution_missing(self) -> None:
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._clear_storage()
        # No exception even though no execution exists.
        execution_service._on_workbench_session_terminated(str(uuid.uuid4()), "passed", None)

    def test_callback_noop_when_execution_already_terminal(self) -> None:
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._clear_storage()
        exec_id = str(uuid.uuid4())
        _exec_storage._execution_storage[exec_id] = {
            "id": exec_id,
            "status": "passed",
            "entity_type": "test",
            "entity_id": str(uuid.uuid4()),
        }
        execution_service._on_workbench_session_terminated(exec_id, "failed", None)
        # Already-terminal executions are not rewritten.
        assert _exec_storage._execution_storage[exec_id]["status"] == "passed"

    def test_callback_persists_snapshot_and_variables_for_test_execution(self) -> None:
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service
        from wavecore.api.services.workbench import _common as _wb_common

        _exec_storage._clear_storage()
        entity_id = str(uuid.uuid4())
        session_id = str(uuid.uuid4())
        _exec_storage._execution_storage[session_id] = {
            "id": session_id,
            "status": "running",
            "entity_type": "test",
            "entity_id": entity_id,
            "started_at": "2026-04-22T00:00:00+00:00",
            "run_id": session_id,
            "workflow_snapshot": {"nodes": [], "edges": []},
        }
        _exec_storage._save_execution(_exec_storage._execution_storage[session_id])
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "test_id": entity_id,
            "block_states": {"b1": "passed"},
            "variables": {"x": 42},
        }

        try:
            execution_service._on_workbench_session_terminated(session_id, "passed", None)
            snapshot = _exec_storage._load_snapshot(session_id, session_id)
            assert snapshot is not None
            assert snapshot["status"] == "passed"
            assert snapshot["variables"] == {"x": 42}
            assert snapshot["workflow"] == {"nodes": [], "edges": []}
            assert _exec_storage._execution_storage[session_id]["status"] == "passed"
        finally:
            _wb_common._workbench_sessions.pop(session_id, None)

    def test_is_namespace_object_true_for_namespace_base_subclass(self) -> None:
        from wavecore.api.services.executions import service as execution_service
        from wavecore.core.namespace_base import NamespaceObjectBase

        class _NS(NamespaceObjectBase):
            pass

        assert execution_service._is_namespace_object(_NS()) is True
        assert execution_service._is_namespace_object({"plain": "dict"}) is False

    def test_callback_defers_to_sequential_driver_for_child_session(self) -> None:
        """When the terminated session belongs to a sequential child the
        execution-service callback early-returns rather than writing its
        own snapshot."""
        import asyncio

        from wavecore.api.services.executions import _sequential
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._clear_storage()
        parent_id = str(uuid.uuid4())
        _exec_storage._execution_storage[parent_id] = {
            "id": parent_id,
            "entity_type": "suite",
            "entity_id": str(uuid.uuid4()),
            "status": "running",
        }
        _exec_storage._save_execution(_exec_storage._execution_storage[parent_id])

        child_id = str(uuid.uuid4())
        _sequential._child_sessions[child_id] = {
            "parent_id": parent_id,
            "run_id": "r-child",
            "event": asyncio.Event(),
            "result": {"status": "failed", "halt_scope": None},
        }
        try:
            with (
                patch(
                    "wavecore.api.services.workbench._common.get_session_snapshot",
                    return_value={
                        "test_id": "t-child",
                        "block_states": {},
                        "variables": {},
                    },
                ),
                patch(
                    "wavecore.api.services.tests.service.get_test_workflow",
                    return_value=None,
                ),
            ):
                execution_service._on_workbench_session_terminated(child_id, "passed", None)
            # The child_id is not an execution id, so no execution record
            # was created - the callback deferred to the sequential driver.
            assert child_id not in _exec_storage._execution_storage
        finally:
            _sequential._child_sessions.pop(child_id, None)


class TestEnrichmentRegressionPath:
    """Exercise enrichment branches that only fire for regression-type
    executions (nested suites list + duplicate_tests metadata)."""

    def test_regression_enrichment_populates_suites_and_duplicate_tests(self) -> None:
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._clear_storage()
        exec_id = str(uuid.uuid4())
        entity_id = str(uuid.uuid4())
        execution = {
            "id": exec_id,
            "entity_type": "regression",
            "entity_id": entity_id,
            "status": "running",
            "started_at": "2026-04-22T00:00:00+00:00",
        }
        _exec_storage._execution_storage[exec_id] = execution
        _exec_storage._save_execution(execution)
        composition = {
            "suites": [
                {
                    "id": "s1",
                    "name": "S1",
                    "tests": [
                        {"id": "t1", "name": "T1", "run_id": "r1"},
                    ],
                }
            ]
        }
        _exec_storage._save_composition(exec_id, composition)
        state = _exec_storage._init_runtime_state(
            exec_id, execution["started_at"], composition, None
        )
        state["runs"]["r1"]["status"] = "passed"
        state["runs"]["r1"]["duration"] = 1.25

        with patch.object(
            execution_service,
            "_get_entity",
            return_value={
                "id": entity_id,
                "name": "Reg",
                "duplicate_tests": {"t1": ["s1"]},
            },
        ):
            detail = execution_service.get_execution(exec_id)

        assert detail is not None
        assert detail["suites"] and detail["suites"][0]["id"] == "s1"
        assert detail["suites"][0]["tests"][0]["id"] == "t1"
        assert detail["duplicate_tests"] == {"t1": ["s1"]}


class TestStopSequentialExecution:
    def test_stop_execution_routes_suite_through_sequential_driver(self) -> None:
        """Suite/regression stop requests skip the workbench stop path
        and delegate to the sequential driver hooks instead."""
        from wavecore.api.services.executions import _sequential
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._clear_storage()
        exec_id = str(uuid.uuid4())
        _exec_storage._execution_storage[exec_id] = {
            "id": exec_id,
            "status": "running",
            "entity_type": "suite",
            "entity_id": str(uuid.uuid4()),
        }
        _exec_storage._save_execution(_exec_storage._execution_storage[exec_id])

        with (
            patch.object(_sequential, "request_stop") as mock_req,
            patch.object(_sequential, "stop_active_child") as mock_kill,
        ):
            result = execution_service.stop_execution(exec_id)

        mock_req.assert_called_once_with(exec_id)
        mock_kill.assert_called_once_with(exec_id)
        assert result["id"] == exec_id


class TestLocateRun:
    def test_locate_run_skips_test_executions_when_looking_for_child(self) -> None:
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._clear_storage()
        # Test-type execution that matches on run_id directly.
        test_exec_id = str(uuid.uuid4())
        _exec_storage._execution_storage[test_exec_id] = {
            "id": test_exec_id,
            "entity_type": "test",
            "run_id": "test-run",
        }
        # Suite-type execution; shouldn't match by the top-level scan.
        suite_exec_id = str(uuid.uuid4())
        _exec_storage._execution_storage[suite_exec_id] = {
            "id": suite_exec_id,
            "entity_type": "suite",
            "run_id": "irrelevant",
        }
        _exec_storage._append_run(
            suite_exec_id,
            {"run_id": "suite-child", "test_id": "t-x", "suite_id": "s-x"},
        )

        direct = execution_service._locate_run("test-run")
        assert direct is not None
        assert direct[0]["id"] == test_exec_id

        child = execution_service._locate_run("suite-child")
        assert child is not None
        assert child[0]["id"] == suite_exec_id
        assert child[1] == "s-x"

        # Unknown id returns None.
        assert execution_service._locate_run("ghost") is None


class TestGetExecutionColdCache:
    def test_get_execution_caches_record_after_disk_load(self) -> None:
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        _exec_storage._clear_storage()
        exec_id = str(uuid.uuid4())
        _exec_storage._save_execution(
            {
                "id": exec_id,
                "status": "passed",
                "entity_type": "test",
                "entity_id": str(uuid.uuid4()),
                "started_at": "2026-04-22T00:00:00+00:00",
            }
        )
        # Remove the in-memory cache so get_execution must fall back to disk.
        _exec_storage._execution_storage.pop(exec_id, None)

        result = execution_service.get_execution(exec_id)
        assert result is not None
        # Subsequent cache now contains the record.
        assert exec_id in _exec_storage._execution_storage


class TestTestRunRowFidelity:
    """A direct test execution's run row must carry the same fields a suite
    execution's rows do; consumers read one shape, not two."""

    def _terminal_test_execution(self) -> str:
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        entity_id = str(uuid.uuid4())
        entity = {"id": entity_id, "name": "t", "workflow": {"nodes": [], "edges": []}}
        with patch.object(execution_service, "_get_entity", return_value=entity):
            with patch(
                "wavecore.api.services.workbench.service.start_workbench_run",
                return_value={"session_id": "x", "status": "running"},
            ):
                created = execution_service.start_execution(
                    entity_type="test", entity_id=entity_id, environment_id=TEST_ENV_ID
                )
        execution_id = created["id"]
        execution_service._on_workbench_session_terminated(execution_id, "passed")
        _exec_storage._execution_storage[execution_id]["status"] = "passed"
        return execution_id

    def test_the_run_row_carries_its_start_time(self) -> None:
        """The run report reads started_at from runtime state, where the test
        path records both halves of the transition."""
        from wavecore.api.services.executions import _storage as _exec_storage

        execution_id = self._terminal_test_execution()
        state = _exec_storage._get_runtime_state(execution_id)
        assert state is not None
        run = next(iter(state["runs"].values()))
        assert run["started_at"] is not None
        assert run["ended_at"] is not None

    def test_per_test_duration_keeps_sub_second_precision(self) -> None:
        from wavecore.api.services.executions import _storage as _exec_storage
        from wavecore.api.services.executions import service as execution_service

        execution_id = self._terminal_test_execution()
        state = _exec_storage._get_runtime_state(execution_id)
        assert state is not None
        for run in state["runs"].values():
            run["duration"] = 0.284
            run["status"] = "passed"

        detail = execution_service.get_execution(execution_id)
        assert detail is not None
        assert detail["tests"][0]["duration"] == 0.284
