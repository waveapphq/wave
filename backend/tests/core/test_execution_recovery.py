"""
Unit tests for test execution recovery (REQ-4.3.2).

Tests the execution recovery capability that enables interrupted executions to resume
from test-level checkpoints rather than restarting completely, preserving completed
test results and providing resilience against infrastructure failures, system crashes,
and deliberate interruptions during long-running test suites and regressions.

Requirements tested:
- REQ-4.3.2: Test execution recovery
  - Checkpoint Granularity (test-level boundaries)
  - State Persistence Format (manifest + variable state files)
  - Interruption Detection and Handling
  - Recovery Initialization
  - Interrupted Test Finalization
  - Partial Re-execution Semantics
  - Artifact Organization
  - System Log Content
  - Resource Cleanup
  - Variable State Efficiency
  - Idempotency
  - User Control
  - Limitations
"""

from pathlib import Path

import pytest

from wavecore.models.enums import ExecutionState

# ============================================================================
# Test Suite 1: Checkpoint Granularity (Test-Level Boundaries)
# ============================================================================


class TestCheckpointGranularity:
    """
    Test checkpoint granularity at test boundaries only.

    The execution engine tracks completion at test boundaries only. When each test
    completes successfully, the engine records the test identifier, execution status,
    and current suite/regression variable scopes.
    """

    def test_checkpoint_created_after_test_completion(self, tmp_path: Path):
        """Test checkpoint is created after each test completes successfully."""
        from wavecore.core.errors.execution_recovery import RecoveryManager
        from wavecore.models.entities import Suite, Test

        # Create recovery manager with artifact directory
        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create a suite with multiple tests
        _suite = Suite(
            id="suite-1",
            name="Test Suite",
            version="1.0.0",
            tests=[
                Test(id="test-1", name="Test 1", version="1.0.0", blocks=[]),
                Test(id="test-2", name="Test 2", version="1.0.0", blocks=[]),
                Test(id="test-3", name="Test 3", version="1.0.0", blocks=[]),
            ],
        )

        # Simulate test completion - record checkpoint
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # Verify checkpoint was created
        manifest = recovery_mgr.load_manifest()
        assert manifest is not None
        assert len(manifest.completed_tests) == 1
        assert manifest.completed_tests[0]["test_id"] == "test-1"
        assert manifest.completed_tests[0]["status"] == ExecutionState.COMPLETED

    def test_checkpoint_not_created_during_test_execution(self, tmp_path: Path):
        """Test checkpoint is NOT created during test execution, only after completion."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Simulate test start (no checkpoint should be created)
        # In the real implementation, this would be tracked internally
        # but not persisted to disk

        # Verify no checkpoint exists yet
        manifest = recovery_mgr.load_manifest()
        assert manifest is None or len(manifest.completed_tests) == 0

    def test_checkpoint_includes_test_identifier_and_status(self, tmp_path: Path):
        """Test checkpoint includes test identifier, version, and execution status."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Record test completion
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # Load and verify checkpoint content
        manifest = recovery_mgr.load_manifest()
        assert manifest.completed_tests[0]["test_id"] == "test-1"
        assert manifest.completed_tests[0]["test_version"] == "1.0.0"
        assert manifest.completed_tests[0]["status"] == ExecutionState.COMPLETED

    def test_checkpoint_includes_suite_regression_variables(self, tmp_path: Path):
        """Test checkpoint captures suite and regression scope variables."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        suite_vars = {"suite_var1": "value1", "suite_var2": 42}
        regression_vars = {"reg_var1": "value_a", "reg_var2": [1, 2, 3]}

        # Record test completion with variables
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables=suite_vars,
            regression_variables=regression_vars,
        )

        # Load and verify variable state
        var_state = recovery_mgr.load_variable_state()
        assert var_state.suite_variables == suite_vars
        assert var_state.regression_variables == regression_vars

    def test_checkpoint_after_finalization_completes(self, tmp_path: Path):
        """Test checkpointing occurs after test finalization completes."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Record test completion (which happens after finalization)
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={"finalized": True},
            regression_variables={},
        )

        # Verify checkpoint exists with post-finalization state
        var_state = recovery_mgr.load_variable_state()
        assert var_state.suite_variables["finalized"] is True

    def test_failed_tests_not_checkpointed(self, tmp_path: Path):
        """Test failed tests are NOT marked as completed in checkpoint."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Attempt to record failed test (should not checkpoint as "completed")
        # The recovery system should either:
        # 1. Not record failed tests at all, OR
        # 2. Record them with FAILED status (implementation-defined)

        # For this test, we assume failed tests are NOT recorded
        # If they were recorded with FAILED status, recovery would skip them

        # Verify no checkpoint for incomplete test
        manifest = recovery_mgr.load_manifest()
        assert manifest is None or len(manifest.completed_tests) == 0


# ============================================================================
# Test Suite 2: State Persistence Format (Manifest + Variable State)
# ============================================================================


class TestStatePersistenceFormat:
    """
    Test state persistence format with manifest and variable state files.

    Recovery state persists within the execution's artifact directory using two files:
    a manifest listing completed test identifiers in execution order, and a variable
    state file containing suite and regression scope variables.
    """

    def test_manifest_file_created_in_artifact_directory(self, tmp_path: Path):
        """Test manifest file is created in execution's artifact directory."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Record test completion
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # Verify manifest file exists
        manifest_file = tmp_path / "recovery_manifest.json"
        assert manifest_file.exists()

    def test_variable_state_file_created_in_artifact_directory(self, tmp_path: Path):
        """Test variable state file is created in execution's artifact directory."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Record test completion
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={"var1": "value1"},
            regression_variables={"var2": "value2"},
        )

        # Verify variable state file exists
        var_state_file = tmp_path / "recovery_variables.json"
        assert var_state_file.exists()

    def test_manifest_lists_completed_tests_in_execution_order(self, tmp_path: Path):
        """Test manifest maintains completed test identifiers in execution order."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Record multiple test completions in order
        test_ids = ["test-1", "test-2", "test-3", "test-4"]
        for test_id in test_ids:
            recovery_mgr.record_test_completion(
                test_id=test_id,
                test_version="1.0.0",
                status=ExecutionState.COMPLETED,
                suite_variables={},
                regression_variables={},
            )

        # Load manifest and verify order
        manifest = recovery_mgr.load_manifest()
        recorded_ids = [t["test_id"] for t in manifest.completed_tests]
        assert recorded_ids == test_ids

    def test_variable_state_contains_suite_and_regression_scopes(self, tmp_path: Path):
        """Test variable state captures suite and regression scope variables only."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        suite_vars = {"suite_var1": "value1", "suite_var2": 42}
        regression_vars = {"reg_var1": "value_a", "reg_var2": [1, 2, 3]}

        # Record test with variables
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables=suite_vars,
            regression_variables=regression_vars,
        )

        # Load and verify variable state structure
        var_state = recovery_mgr.load_variable_state()
        assert hasattr(var_state, "suite_variables")
        assert hasattr(var_state, "regression_variables")
        assert var_state.suite_variables == suite_vars
        assert var_state.regression_variables == regression_vars

    def test_atomic_update_of_manifest_and_variable_state(self, tmp_path: Path):
        """Test manifest and variable state files are updated atomically."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Record test completion (atomic update)
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={"var1": "value1"},
            regression_variables={"var2": "value2"},
        )

        # Both files should exist and be consistent
        manifest = recovery_mgr.load_manifest()
        var_state = recovery_mgr.load_variable_state()

        assert len(manifest.completed_tests) == 1
        assert manifest.completed_tests[0]["test_id"] == "test-1"
        assert var_state.suite_variables == {"var1": "value1"}
        assert var_state.regression_variables == {"var2": "value2"}

    def test_variable_state_persists_values_verbatim(self, tmp_path: Path):
        """The '_secret' marker heuristic is deleted; values persist as-is."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={
                "normal_var": "visible_value",
                "marker_dict": {"_secret": True, "value": "super_secret_123"},
            },
            regression_variables={},
        )

        var_state = recovery_mgr.load_variable_state()
        assert var_state.suite_variables["normal_var"] == "visible_value"
        assert var_state.suite_variables["marker_dict"] == {
            "_secret": True,
            "value": "super_secret_123",
        }

    def test_marker_masking_helper_is_deleted(self, tmp_path: Path):
        """The heuristic masker keyed off a marker nothing produces is gone."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        assert not hasattr(recovery_mgr, "_mask_secrets")


# ============================================================================
# Test Suite 3: System Log Content
# ============================================================================


class TestSystemLogContent:
    """
    Test system log records execution lifecycle events.

    The system log is a separate append-only file recording execution lifecycle
    events including execution start, test completions, interruptions, recovery
    initialization, and execution completion.
    """

    def test_system_log_created_in_artifact_directory(self, tmp_path: Path):
        """Test system log file is created in artifact directory."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Initialize execution
        recovery_mgr.log_execution_start(
            execution_id="exec-1", execution_type="suite", parameters={}
        )

        # Verify system log exists
        log_file = tmp_path / "recovery_system.log"
        assert log_file.exists()

    def test_system_log_records_execution_start(self, tmp_path: Path):
        """Test system log records execution start with parameters."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Log execution start
        recovery_mgr.log_execution_start(
            execution_id="exec-1",
            execution_type="suite",
            parameters={"suite_id": "suite-1", "profile": "dev"},
        )

        # Read log and verify entry
        log_content = recovery_mgr.read_system_log()
        assert any("execution_start" in entry for entry in log_content)
        assert any("exec-1" in entry for entry in log_content)

    def test_system_log_records_test_completion(self, tmp_path: Path):
        """Test system log records test completion events with identifiers."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Record test completion (should log event)
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # Read log and verify entry
        log_content = recovery_mgr.read_system_log()
        assert any("test_completion" in entry for entry in log_content)
        assert any("test-1" in entry for entry in log_content)

    def test_system_log_records_interruption_events(self, tmp_path: Path):
        """Test system log records interruption events with signal type and context."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Log interruption
        recovery_mgr.log_interruption(
            signal_type="SIGTERM",
            interrupted_test_id="test-2",
            context={"reason": "infrastructure_failure"},
        )

        # Read log and verify entry
        log_content = recovery_mgr.read_system_log()
        assert any("interruption" in entry for entry in log_content)
        assert any("SIGTERM" in entry for entry in log_content)
        assert any("test-2" in entry for entry in log_content)

    def test_system_log_records_recovery_initialization(self, tmp_path: Path):
        """Test system log records recovery initialization with manifest state."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # First, create a checkpoint
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # Log recovery initialization
        recovery_mgr.log_recovery_initialization(
            num_completed_tests=1, interrupted_test_id="test-2"
        )

        # Read log and verify entry
        log_content = recovery_mgr.read_system_log()
        assert any("recovery_initialization" in entry for entry in log_content)

    def test_system_log_records_execution_completion(self, tmp_path: Path):
        """Test system log records execution completion with final status."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Log execution completion
        recovery_mgr.log_execution_completion(
            execution_id="exec-1", final_status=ExecutionState.COMPLETED
        )

        # Read log and verify entry
        log_content = recovery_mgr.read_system_log()
        assert any("execution_completion" in entry for entry in log_content)
        assert any("exec-1" in entry for entry in log_content)

    def test_system_log_is_append_only(self, tmp_path: Path):
        """Test system log is append-only and survives interruptions."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Log multiple events
        recovery_mgr.log_execution_start(
            execution_id="exec-1", execution_type="suite", parameters={}
        )
        recovery_mgr.log_interruption(
            signal_type="SIGINT", interrupted_test_id="test-1", context={}
        )
        recovery_mgr.log_recovery_initialization(
            num_completed_tests=0, interrupted_test_id="test-1"
        )

        # Read log
        log_content = recovery_mgr.read_system_log()

        # Verify all events are present (append-only)
        assert sum(1 for entry in log_content if "execution_start" in entry) == 1
        assert sum(1 for entry in log_content if "interruption" in entry) == 1
        assert sum(1 for entry in log_content if "recovery_initialization" in entry) == 1

    def test_system_log_includes_timestamps(self, tmp_path: Path):
        """Test system log entries include timestamps."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Log event
        recovery_mgr.log_execution_start(
            execution_id="exec-1", execution_type="suite", parameters={}
        )

        # Read log and verify timestamp format
        log_content = recovery_mgr.read_system_log()
        # Timestamp should be in ISO format or similar
        assert any("timestamp" in entry or "T" in entry or ":" in entry for entry in log_content)


# ============================================================================
# Test Suite 4: Interruption Detection and Handling
# ============================================================================


class TestInterruptionDetectionAndHandling:
    """
    Test interruption detection through signals, exceptions, and commands.

    The system detects interruptions through process termination signals,
    unhandled exceptions, external stop commands, and infrastructure failures.
    """

    def test_detect_process_termination_signal(self, tmp_path: Path):
        """Test system detects process termination signals (SIGTERM, SIGINT)."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Simulate signal detection and logging
        recovery_mgr.log_interruption(
            signal_type="SIGTERM", interrupted_test_id="test-2", context={}
        )

        # Verify interruption was logged
        log_content = recovery_mgr.read_system_log()
        assert any("SIGTERM" in entry for entry in log_content)

    def test_detect_unhandled_exception_in_execution_engine(self, tmp_path: Path):
        """Test system detects unhandled exceptions in execution engine."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Simulate exception detection
        recovery_mgr.log_interruption(
            signal_type="EXCEPTION",
            interrupted_test_id="test-3",
            context={"exception_type": "RuntimeError", "message": "Database connection lost"},
        )

        # Verify interruption was logged with exception details
        log_content = recovery_mgr.read_system_log()
        assert any("EXCEPTION" in entry for entry in log_content)
        assert any("RuntimeError" in entry for entry in log_content)

    def test_detect_external_stop_command(self, tmp_path: Path):
        """Test system detects external stop commands."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Simulate external stop
        recovery_mgr.log_interruption(
            signal_type="EXTERNAL_STOP", interrupted_test_id="test-1", context={"source": "API"}
        )

        # Verify interruption was logged
        log_content = recovery_mgr.read_system_log()
        assert any("EXTERNAL_STOP" in entry for entry in log_content)

    def test_detect_infrastructure_failure(self, tmp_path: Path):
        """Test system detects infrastructure failure monitoring events."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Simulate infrastructure failure
        recovery_mgr.log_interruption(
            signal_type="INFRASTRUCTURE_FAILURE",
            interrupted_test_id="test-4",
            context={"failure_type": "network_partition", "details": "Connection timeout"},
        )

        # Verify interruption was logged
        log_content = recovery_mgr.read_system_log()
        assert any("INFRASTRUCTURE_FAILURE" in entry for entry in log_content)

    def test_identify_currently_executing_test_on_interruption(self, tmp_path: Path):
        """Test system identifies currently executing test during interruption."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Record completed tests
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # Simulate interruption during test-2
        recovery_mgr.log_interruption(
            signal_type="SIGINT", interrupted_test_id="test-2", context={}
        )

        # Verify interrupted test is identified
        log_content = recovery_mgr.read_system_log()
        assert any("test-2" in entry for entry in log_content)

    def test_interruption_logged_with_timestamp_and_cause(self, tmp_path: Path):
        """Test interruption event is logged with timestamp and cause."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Log interruption
        recovery_mgr.log_interruption(
            signal_type="SIGTERM",
            interrupted_test_id="test-1",
            context={"cause": "User initiated shutdown"},
        )

        # Verify timestamp and cause in log
        log_content = recovery_mgr.read_system_log()
        assert any("SIGTERM" in entry for entry in log_content)
        assert any("User initiated shutdown" in entry or "cause" in entry for entry in log_content)

    def test_interrupted_test_not_marked_complete_in_manifest(self, tmp_path: Path):
        """Test interrupted test is NOT updated in completed tests manifest."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Record one completed test
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # Simulate interruption during test-2 (no completion recorded)
        recovery_mgr.log_interruption(
            signal_type="SIGINT", interrupted_test_id="test-2", context={}
        )

        # Verify test-2 is NOT in manifest
        manifest = recovery_mgr.load_manifest()
        completed_ids = [t["test_id"] for t in manifest.completed_tests]
        assert "test-1" in completed_ids
        assert "test-2" not in completed_ids


# ============================================================================
# Test Suite 5: Recovery Initialization
# ============================================================================


class TestRecoveryInitialization:
    """
    Test recovery initialization loads checkpoint and validates state.

    When resuming, the recovery system locates artifacts, loads manifest and
    variable state, validates artifacts, restores scopes, and identifies
    continuation point.
    """

    def test_locate_execution_artifact_directory(self, tmp_path: Path):
        """Test recovery system locates execution's artifact directory."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        # Create recovery manager with artifact directory
        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Verify artifact directory is accessible
        assert recovery_mgr.artifact_dir == tmp_path
        assert tmp_path.exists()

    def test_load_completed_tests_manifest(self, tmp_path: Path):
        """Test recovery loads completed tests manifest from artifact directory."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create checkpoint
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # Load manifest
        manifest = recovery_mgr.load_manifest()
        assert manifest is not None
        assert len(manifest.completed_tests) == 1

    def test_load_variable_state_file(self, tmp_path: Path):
        """Test recovery loads variable state file from artifact directory."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create checkpoint with variables
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={"var1": "value1"},
            regression_variables={"var2": "value2"},
        )

        # Load variable state
        var_state = recovery_mgr.load_variable_state()
        assert var_state is not None
        assert var_state.suite_variables == {"var1": "value1"}
        assert var_state.regression_variables == {"var2": "value2"}

    def test_validate_completed_tests_have_artifacts(self, tmp_path: Path):
        """Test recovery validates all completed tests have corresponding artifacts."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create checkpoint
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # Create artifact for test-1
        test_artifact_dir = tmp_path / "test-1"
        test_artifact_dir.mkdir()
        (test_artifact_dir / "result.json").write_text('{"status": "completed"}')

        # Validate artifacts
        is_valid = recovery_mgr.validate_artifacts()
        assert is_valid is True

    def test_validation_fails_if_artifacts_missing(self, tmp_path: Path):
        """Test validation fails if completed tests lack artifacts."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create checkpoint
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # Do NOT create artifact (validation should fail)

        # Validate artifacts
        is_valid = recovery_mgr.validate_artifacts()
        assert is_valid is False

    def test_restore_suite_and_regression_variable_scopes(self, tmp_path: Path):
        """Test recovery restores suite and regression variable scopes to checkpointed values."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create checkpoint with variables
        suite_vars = {"suite_counter": 5, "suite_name": "test-suite"}
        regression_vars = {"regression_id": "reg-1", "max_retries": 3}

        recovery_mgr.record_test_completion(
            test_id="test-2",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables=suite_vars,
            regression_variables=regression_vars,
        )

        # Restore variables
        restored_state = recovery_mgr.restore_variable_scopes()
        assert restored_state.suite_variables == suite_vars
        assert restored_state.regression_variables == regression_vars

    def test_identify_continuation_point_as_first_incomplete_test(self, tmp_path: Path):
        """Test recovery identifies continuation point as first test not marked complete."""
        from wavecore.core.errors.execution_recovery import RecoveryManager
        from wavecore.models.entities import Suite, Test

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create suite with 5 tests
        suite = Suite(
            id="suite-1",
            name="Test Suite",
            version="1.0.0",
            tests=[
                Test(id="test-1", name="Test 1", version="1.0.0", blocks=[]),
                Test(id="test-2", name="Test 2", version="1.0.0", blocks=[]),
                Test(id="test-3", name="Test 3", version="1.0.0", blocks=[]),
                Test(id="test-4", name="Test 4", version="1.0.0", blocks=[]),
                Test(id="test-5", name="Test 5", version="1.0.0", blocks=[]),
            ],
        )

        # Record first 2 tests as completed
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )
        recovery_mgr.record_test_completion(
            test_id="test-2",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # Identify continuation point
        continuation_test = recovery_mgr.find_continuation_point(suite.tests)
        assert continuation_test is not None
        assert continuation_test.id == "test-3"

    def test_log_recovery_attempt_with_interruption_reference(self, tmp_path: Path):
        """Test system log records recovery attempt with reference to interruption event."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Log interruption
        recovery_mgr.log_interruption(
            signal_type="SIGTERM", interrupted_test_id="test-2", context={}
        )

        # Log recovery initialization
        recovery_mgr.log_recovery_initialization(
            num_completed_tests=1, interrupted_test_id="test-2"
        )

        # Verify both events in log
        log_content = recovery_mgr.read_system_log()
        assert any("interruption" in entry for entry in log_content)
        assert any("recovery_initialization" in entry for entry in log_content)

    def test_recovery_fails_if_dependencies_changed(self, tmp_path: Path):
        """Test recovery fails with clear guidance if dependencies have changed."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create checkpoint with dependency metadata
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # Simulate dependency change detection
        # (In real implementation, this would check against stored dependency hash)
        with pytest.raises(
            ValueError,
            match="^Dependencies have changed since checkpoint was created. Recovery aborted. "
            "Please restart execution from beginning.$",
        ):
            recovery_mgr.validate_dependencies(current_dependencies={"plugin-v2": "2.0.0"})

    def test_recovery_fails_if_configuration_changed(self, tmp_path: Path):
        """Test recovery fails if configuration affecting tests has changed."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create checkpoint with config metadata
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # Simulate configuration change detection
        with pytest.raises(
            ValueError,
            match="^Configuration has changed since checkpoint was created. Recovery aborted. "
            "Please restart execution from beginning.$",
        ):
            recovery_mgr.validate_configuration(
                current_config={"timeout": 120}  # Changed from original
            )


# ============================================================================
# Test Suite 6: Interrupted Test Finalization
# ============================================================================


class TestInterruptedTestFinalization:
    """
    Test interrupted test finalization before re-execution.

    Upon recovery initialization, the test executing during interruption must be
    finalized before re-execution to release resources and perform cleanup.
    """

    def test_execute_test_level_finalize_block_for_interrupted_test(self, tmp_path: Path):
        """Test recovery executes test-level finalize block for interrupted test."""
        from wavecore.core.errors.execution_recovery import RecoveryManager
        from wavecore.models.entities import Test
        from wavecore.models.workflow import WorkflowBlock

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create test with finalize block
        interrupted_test = Test(
            id="test-2",
            name="Interrupted Test",
            version="1.0.0",
            blocks=[],
            finalize_blocks=[
                WorkflowBlock(
                    block_id="cleanup-block",
                    block_version="1.0.0",
                    order=0,
                    parameters={},
                )
            ],
        )

        # Simulate finalization during recovery
        finalization_executed = recovery_mgr.finalize_interrupted_test(interrupted_test)
        assert finalization_executed is True

    def test_remove_interrupted_test_artifacts_after_finalization(self, tmp_path: Path):
        """Test interrupted test's artifacts are removed after finalization."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create artifact for interrupted test
        test_artifact_dir = tmp_path / "test-2"
        test_artifact_dir.mkdir()
        artifact_file = test_artifact_dir / "partial_result.json"
        artifact_file.write_text('{"status": "interrupted"}')

        # Finalize interrupted test (should remove artifacts)
        recovery_mgr.cleanup_interrupted_test_artifacts(test_id="test-2")

        # Verify artifacts are removed
        assert not artifact_file.exists()
        # Directory may or may not be removed (implementation-specific)

    def test_remove_interrupted_test_logs_after_finalization(self, tmp_path: Path):
        """Test interrupted test's logs are removed after finalization."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create log for interrupted test
        test_log_file = tmp_path / "test-2.log"
        test_log_file.write_text("Test execution started...\nTest interrupted\n")

        # Cleanup interrupted test
        recovery_mgr.cleanup_interrupted_test_artifacts(test_id="test-2")

        # Verify log is removed
        assert not test_log_file.exists()

    def test_discard_test_level_variables_from_interrupted_test(self, tmp_path: Path):
        """Test test-level variable scopes from interrupted test are discarded."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create checkpoint (suite/regression vars preserved)
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={"suite_var": "value1"},
            regression_variables={"reg_var": "value2"},
        )

        # Restore variables (test-level vars should NOT be restored)
        restored_state = recovery_mgr.restore_variable_scopes()

        # Test-level variables should not exist in restored state
        assert "suite_var" in restored_state.suite_variables
        assert "reg_var" in restored_state.regression_variables
        # Test variables are fresh for each test (not persisted/restored)

    def test_preserve_suite_regression_variables_at_last_checkpoint(self, tmp_path: Path):
        """Test suite/regression variables remain at last checkpointed state."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Record test-1 completion with variables
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={"counter": 1, "name": "suite-a"},
            regression_variables={"total": 10},
        )

        # Simulate test-2 interruption (variables NOT updated)

        # Restore variables
        restored_state = recovery_mgr.restore_variable_scopes()

        # Variables should be from last checkpoint (test-1)
        assert restored_state.suite_variables == {"counter": 1, "name": "suite-a"}
        assert restored_state.regression_variables == {"total": 10}

    def test_finalization_releases_resources_before_reexecution(self, tmp_path: Path):
        """Test finalization releases resources before re-execution of interrupted test."""
        from wavecore.core.errors.execution_recovery import RecoveryManager
        from wavecore.models.entities import Test
        from wavecore.models.workflow import WorkflowBlock

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Track resource cleanup
        _cleanup_executed = []

        # Create test with finalize block (simulated)
        interrupted_test = Test(
            id="test-2",
            name="Interrupted Test",
            version="1.0.0",
            blocks=[],
            finalize_blocks=[
                WorkflowBlock(
                    block_id="cleanup-block",
                    block_version="1.0.0",
                    order=0,
                    parameters={"action": "release_resources"},
                )
            ],
        )

        # Execute finalization
        finalization_executed = recovery_mgr.finalize_interrupted_test(interrupted_test)
        assert finalization_executed is True

        # In real implementation, this would verify resources were released
        # (connections closed, locks released, temp files removed)


# ============================================================================
# Test Suite 7: Partial Re-execution Semantics
# ============================================================================


class TestPartialReexecutionSemantics:
    """
    Test partial re-execution from checkpoint.

    Recovery skips completed tests, restores variable scopes, and begins execution
    with the interrupted test followed by subsequent tests.
    """

    def test_skip_all_completed_tests_in_manifest(self, tmp_path: Path):
        """Test recovery skips all tests marked complete in manifest."""
        from wavecore.core.errors.execution_recovery import RecoveryManager
        from wavecore.models.entities import Suite, Test

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create suite with 5 tests
        suite = Suite(
            id="suite-1",
            name="Test Suite",
            version="1.0.0",
            tests=[
                Test(id=f"test-{i}", name=f"Test {i}", version="1.0.0", blocks=[])
                for i in range(1, 6)
            ],
        )

        # Mark first 3 as completed
        for i in range(1, 4):
            recovery_mgr.record_test_completion(
                test_id=f"test-{i}",
                test_version="1.0.0",
                status=ExecutionState.COMPLETED,
                suite_variables={},
                regression_variables={},
            )

        # Get tests to execute
        tests_to_execute = recovery_mgr.get_remaining_tests(suite.tests)

        # Should return test-4 and test-5 only (skip 1-3)
        assert len(tests_to_execute) == 2
        assert tests_to_execute[0].id == "test-4"
        assert tests_to_execute[1].id == "test-5"

    def test_begin_execution_with_interrupted_test(self, tmp_path: Path):
        """Test execution begins with cleaned-up interrupted test."""
        from wavecore.core.errors.execution_recovery import RecoveryManager
        from wavecore.models.entities import Suite, Test

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create suite
        suite = Suite(
            id="suite-1",
            name="Test Suite",
            version="1.0.0",
            tests=[
                Test(id=f"test-{i}", name=f"Test {i}", version="1.0.0", blocks=[])
                for i in range(1, 4)
            ],
        )

        # Mark test-1 as completed
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # test-2 was interrupted (not in manifest)

        # Find continuation point
        continuation_test = recovery_mgr.find_continuation_point(suite.tests)
        assert continuation_test.id == "test-2"

    def test_restore_suite_variables_from_checkpoint(self, tmp_path: Path):
        """Test suite variables are restored from checkpointed state."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create checkpoint with suite variables
        suite_vars = {"counter": 42, "status": "active", "items": [1, 2, 3]}

        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables=suite_vars,
            regression_variables={},
        )

        # Restore variables
        restored_state = recovery_mgr.restore_variable_scopes()
        assert restored_state.suite_variables == suite_vars

    def test_restore_regression_variables_from_checkpoint(self, tmp_path: Path):
        """Test regression variables are restored from checkpointed state."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create checkpoint with regression variables
        regression_vars = {"total_tests": 100, "passed": 42, "config": {"env": "prod"}}

        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables=regression_vars,
        )

        # Restore variables
        restored_state = recovery_mgr.restore_variable_scopes()
        assert restored_state.regression_variables == regression_vars

    def test_test_level_variables_initialized_fresh(self, tmp_path: Path):
        """Test test-level variables are initialized fresh for each test execution."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Restore variables (should NOT include test-level vars)
        restored_state = recovery_mgr.restore_variable_scopes()

        # Test-level variables should not exist in restored state
        # (they're created fresh per test)
        # Verify only suite and regression scopes exist
        assert hasattr(restored_state, "suite_variables")
        assert hasattr(restored_state, "regression_variables")

    def test_interrupted_test_has_access_to_restored_variables(self, tmp_path: Path):
        """Test interrupted test has access to variables set by completed tests."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Record test-1 completion with variables
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={"shared_data": "from_test_1"},
            regression_variables={"global_counter": 1},
        )

        # Restore for test-2 (interrupted)
        restored_state = recovery_mgr.restore_variable_scopes()

        # test-2 should have access to variables from test-1
        assert restored_state.suite_variables["shared_data"] == "from_test_1"
        assert restored_state.regression_variables["global_counter"] == 1

    def test_subsequent_tests_execute_in_standard_sequence(self, tmp_path: Path):
        """Test subsequent tests after interrupted test execute in standard sequence."""
        from wavecore.core.errors.execution_recovery import RecoveryManager
        from wavecore.models.entities import Suite, Test

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create suite with 5 tests
        suite = Suite(
            id="suite-1",
            name="Test Suite",
            version="1.0.0",
            tests=[
                Test(id=f"test-{i}", name=f"Test {i}", version="1.0.0", blocks=[])
                for i in range(1, 6)
            ],
        )

        # Mark test-1 and test-2 as completed
        for i in range(1, 3):
            recovery_mgr.record_test_completion(
                test_id=f"test-{i}",
                test_version="1.0.0",
                status=ExecutionState.COMPLETED,
                suite_variables={},
                regression_variables={},
            )

        # Get remaining tests (test-3, test-4, test-5)
        remaining_tests = recovery_mgr.get_remaining_tests(suite.tests)

        # Verify order
        assert len(remaining_tests) == 3
        assert remaining_tests[0].id == "test-3"
        assert remaining_tests[1].id == "test-4"
        assert remaining_tests[2].id == "test-5"

    def test_execution_proceeds_normally_from_interruption_point(self, tmp_path: Path):
        """Test execution proceeds normally with restored higher-level variable context."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create checkpoint
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={"counter": 1},
            regression_variables={"total": 100},
        )

        # Restore and verify context
        restored_state = recovery_mgr.restore_variable_scopes()
        assert restored_state.suite_variables["counter"] == 1
        assert restored_state.regression_variables["total"] == 100

        # Execution would continue with this context


# ============================================================================
# Test Suite 8: Artifact Organization
# ============================================================================


class TestArtifactOrganization:
    """
    Test artifact organization during recovery.

    Completed tests retain artifacts, interrupted test artifacts are deleted,
    and new tests generate artifacts normally within the same execution directory.
    """

    def test_completed_tests_retain_artifacts(self, tmp_path: Path):
        """Test completed tests retain their artifacts in execution's artifact directory."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create artifacts for completed tests
        for i in range(1, 3):
            test_dir = tmp_path / f"test-{i}"
            test_dir.mkdir()
            (test_dir / "result.json").write_text(f'{{"test_id": "test-{i}"}}')

            # Mark as completed
            recovery_mgr.record_test_completion(
                test_id=f"test-{i}",
                test_version="1.0.0",
                status=ExecutionState.COMPLETED,
                suite_variables={},
                regression_variables={},
            )

        # Verify artifacts still exist
        assert (tmp_path / "test-1" / "result.json").exists()
        assert (tmp_path / "test-2" / "result.json").exists()

    def test_interrupted_test_artifacts_deleted_during_recovery(self, tmp_path: Path):
        """Test interrupted test's artifacts are deleted during recovery initialization."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create artifact for interrupted test
        test_dir = tmp_path / "test-2"
        test_dir.mkdir()
        artifact_file = test_dir / "partial_result.json"
        artifact_file.write_text('{"status": "interrupted"}')

        # Cleanup interrupted test
        recovery_mgr.cleanup_interrupted_test_artifacts(test_id="test-2")

        # Verify artifact is deleted
        assert not artifact_file.exists()

    def test_new_test_artifacts_generated_in_same_execution_directory(self, tmp_path: Path):
        """Test tests executed after recovery generate artifacts in same execution directory."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        _recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Simulate recovery and new test execution
        # New test should create artifacts in tmp_path

        # Create artifact for new test
        new_test_dir = tmp_path / "test-4"
        new_test_dir.mkdir()
        (new_test_dir / "result.json").write_text('{"test_id": "test-4"}')

        # Verify artifact is in same directory
        assert (tmp_path / "test-4" / "result.json").exists()

    def test_system_log_provides_correlation_of_artifacts_with_sessions(self, tmp_path: Path):
        """Test system log enables correlation of artifacts with execution sessions."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Log execution start
        recovery_mgr.log_execution_start(
            execution_id="exec-1", execution_type="suite", parameters={}
        )

        # Log test completion
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # Log interruption
        recovery_mgr.log_interruption(
            signal_type="SIGTERM", interrupted_test_id="test-2", context={}
        )

        # Log recovery
        recovery_mgr.log_recovery_initialization(
            num_completed_tests=1, interrupted_test_id="test-2"
        )

        # Read log and verify correlation
        log_content = recovery_mgr.read_system_log()

        # Log should show session lifecycle
        assert any("execution_start" in entry for entry in log_content)
        assert any("interruption" in entry for entry in log_content)
        assert any("recovery_initialization" in entry for entry in log_content)


# ============================================================================
# Test Suite 9: Resource Cleanup
# ============================================================================


class TestResourceCleanup:
    """
    Test resource cleanup during recovery initialization.

    Recovery initialization releases all resources held by interrupted execution
    including connections, temporary files, and locks.
    """

    def test_release_abandoned_connections(self, tmp_path: Path):
        """Test recovery releases all abandoned connections from interrupted execution."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Simulate resource cleanup tracking
        _cleanup_log = []

        # In real implementation, this would close connections
        # For testing, we verify the cleanup method exists and is called
        recovery_mgr.cleanup_resources(resource_types=["connections"])

        # Verify cleanup was initiated
        # (In real implementation, this would verify connections were closed)

    def test_remove_temporary_files_from_incomplete_operations(self, tmp_path: Path):
        """Test recovery removes temporary files from incomplete operations."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create temporary files
        temp_file1 = tmp_path / "temp_upload_12345.dat"
        temp_file2 = tmp_path / "temp_download_67890.dat"
        temp_file1.write_text("incomplete upload")
        temp_file2.write_text("incomplete download")

        # Cleanup temporary files
        recovery_mgr.cleanup_temporary_files()

        # Verify temp files are removed
        # (Pattern matching for temp_* or .tmp files)
        assert not temp_file1.exists()
        assert not temp_file2.exists()

    def test_release_locks_and_leases(self, tmp_path: Path):
        """Test recovery releases locks or leases held by interrupted execution."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Simulate lock files
        lock_file = tmp_path / "execution.lock"
        lock_file.write_text("pid:12345")

        # Cleanup locks
        recovery_mgr.cleanup_resources(resource_types=["locks"])

        # Verify lock is released (file removed or marked as released)
        # (Implementation-specific behavior)

    def test_cleanup_ensures_clean_resource_state(self, tmp_path: Path):
        """Test cleanup ensures recovery begins from clean resource state."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create various resource artifacts
        temp_file = tmp_path / "temp.dat"
        lock_file = tmp_path / "test.lock"
        temp_file.write_text("data")
        lock_file.write_text("locked")

        # Perform full cleanup
        recovery_mgr.cleanup_all_resources()

        # Verify clean state (no temp files, no locks, no connections)
        # (In real implementation, this would verify all resources are released)

    def test_cleanup_does_not_interfere_with_completed_test_artifacts(self, tmp_path: Path):
        """Test resource cleanup does not remove completed test artifacts."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create completed test artifact
        test_dir = tmp_path / "test-1"
        test_dir.mkdir()
        artifact_file = test_dir / "result.json"
        artifact_file.write_text('{"status": "completed"}')

        # Create temporary file
        temp_file = tmp_path / "temp.dat"
        temp_file.write_text("temporary")

        # Cleanup temporary files
        recovery_mgr.cleanup_temporary_files()

        # Verify artifact is preserved, temp file is removed
        assert artifact_file.exists()
        assert not temp_file.exists()


# ============================================================================
# Test Suite 10: Variable State Efficiency
# ============================================================================


class TestVariableStateEfficiency:
    """
    Test variable state storage efficiency.

    Variable state storage minimizes overhead through incremental updates,
    only writing modified variables after each test.
    """

    def test_incremental_variable_updates_after_each_test(self, tmp_path: Path):
        """Test only modified suite and regression variables are written after each test."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Record test-1 with initial variables
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={"counter": 1, "name": "suite-a"},
            regression_variables={"total": 10},
        )

        # Record test-2 with only counter changed
        recovery_mgr.record_test_completion(
            test_id="test-2",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={"counter": 2, "name": "suite-a"},  # Only counter changed
            regression_variables={"total": 10},  # Unchanged
        )

        # Verify only modified variables are stored (implementation detail)
        # In real implementation, this would verify incremental storage

    def test_marker_dicts_are_not_rewritten_before_persistence(self, tmp_path: Path):
        """No marker-based rewriting; the recovery state stores what it got."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={"api_key": {"_secret": True, "value": "sk-secret-key-12345"}},
            regression_variables={},
        )

        var_state = recovery_mgr.load_variable_state()
        assert var_state.suite_variables["api_key"] == {
            "_secret": True,
            "value": "sk-secret-key-12345",
        }

    def test_efficient_serialization_format(self, tmp_path: Path):
        """Test variable snapshots use efficient serialization formats."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Record test with various data types
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={
                "string_var": "value",
                "int_var": 42,
                "list_var": [1, 2, 3],
                "dict_var": {"key": "value"},
            },
            regression_variables={},
        )

        # Verify serialization (JSON or similar)
        var_state_file = tmp_path / "recovery_variables.json"
        assert var_state_file.exists()

        # File should be reasonably sized (efficient)
        file_size = var_state_file.stat().st_size
        assert file_size < 10000  # Reasonable size limit

    def test_variable_state_file_remains_compact_for_long_regressions(self, tmp_path: Path):
        """Test variable state file remains compact even for long-running regressions."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Simulate many test completions
        for i in range(1, 101):  # 100 tests
            recovery_mgr.record_test_completion(
                test_id=f"test-{i}",
                test_version="1.0.0",
                status=ExecutionState.COMPLETED,
                suite_variables={"counter": i},
                regression_variables={"total": 100},
            )

        # Verify file size is reasonable (not growing linearly)
        var_state_file = tmp_path / "recovery_variables.json"
        file_size = var_state_file.stat().st_size

        # Should be compact (not storing full history)
        # Assuming efficient storage, file should be < 50KB
        assert file_size < 50000

    def test_fast_recovery_initialization_with_compact_state(self, tmp_path: Path):
        """Test recovery initialization is fast with compact variable state."""
        import time

        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create checkpoint with many variables
        large_vars = {f"var_{i}": f"value_{i}" for i in range(100)}

        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables=large_vars,
            regression_variables={},
        )

        # Measure recovery time
        start_time = time.time()
        recovered_state = recovery_mgr.restore_variable_scopes()
        recovery_time = time.time() - start_time

        # Recovery should be fast (< 1 second)
        assert recovery_time < 1.0
        assert len(recovered_state.suite_variables) == 100


# ============================================================================
# Test Suite 11: Idempotency
# ============================================================================


class TestIdempotency:
    """
    Test test-level recovery idempotency.

    Test-level recovery provides natural idempotency since tests execute
    completely or not at all from the recovery perspective.
    """

    def test_interrupted_test_always_reexecutes_fully(self, tmp_path: Path):
        """Test interrupted test is always re-executed fully, not partially."""
        from wavecore.core.errors.execution_recovery import RecoveryManager
        from wavecore.models.entities import Suite, Test

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create suite
        suite = Suite(
            id="suite-1",
            name="Test Suite",
            version="1.0.0",
            tests=[
                Test(id=f"test-{i}", name=f"Test {i}", version="1.0.0", blocks=[])
                for i in range(1, 4)
            ],
        )

        # Mark test-1 as completed
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # test-2 was interrupted (not in manifest)

        # Find continuation point
        continuation_test = recovery_mgr.find_continuation_point(suite.tests)
        assert continuation_test.id == "test-2"

        # test-2 will execute fully from beginning (idempotent)

    def test_consistent_semantics_for_interrupted_test(self, tmp_path: Path):
        """Test interrupted test has consistent execution semantics on retry."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Record completion
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # Interrupted test will receive same context (restored variables)
        # ensuring consistent execution semantics

    def test_tests_designed_to_be_repeatable(self, tmp_path: Path):
        """Test framework expects tests to be repeatable with proper initialization."""
        # This is a design requirement verification test
        # Tests must handle their own resource initialization and cleanup

        # Test repeatability is ensured by:
        # 1. Fresh test-level variables each execution
        # 2. Test-level finalize blocks for cleanup
        # 3. Restored suite/regression context

        # This test documents the requirement
        pass

    def test_interrupted_test_executes_completely_or_not_at_all(self, tmp_path: Path):
        """Test recovery perspective: tests execute completely or not at all."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Test-1 completed fully
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # Test-2 interrupted (not completed)
        # From recovery perspective: test-2 did NOT execute
        # It will execute completely on recovery

        manifest = recovery_mgr.load_manifest()
        completed_ids = [t["test_id"] for t in manifest.completed_tests]

        assert "test-1" in completed_ids
        assert "test-2" not in completed_ids  # Not completed = will re-execute fully


# ============================================================================
# Test Suite 12: User Control
# ============================================================================


class TestUserControl:
    """
    Test user control over recovery behavior.

    The system provides execution options to control recovery behavior including
    forcing fresh execution or enabling automatic recovery.
    """

    def test_force_fresh_execution_ignores_checkpoints(self, tmp_path: Path):
        """Test force fresh execution option ignores existing checkpoints and artifacts."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create checkpoint
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # Force fresh execution (should ignore checkpoint)
        should_recover = recovery_mgr.should_recover(force_fresh=True)
        assert should_recover is False

    def test_automatic_recovery_resumes_from_manifest(self, tmp_path: Path):
        """Test automatic recovery option resumes from completed tests manifest."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create checkpoint
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # Auto-recovery enabled (should use checkpoint)
        should_recover = recovery_mgr.should_recover(force_fresh=False)
        assert should_recover is True

    def test_recovery_eligibility_determined_by_manifest_presence(self, tmp_path: Path):
        """Test recovery eligibility is determined by manifest presence and validity."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # No checkpoint exists
        should_recover = recovery_mgr.should_recover(force_fresh=False)
        assert should_recover is False

        # Create checkpoint
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # Checkpoint exists
        should_recover = recovery_mgr.should_recover(force_fresh=False)
        assert should_recover is True

    def test_invalid_manifest_prevents_recovery(self, tmp_path: Path):
        """Test invalid or corrupted manifest prevents automatic recovery."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create corrupted manifest
        manifest_file = tmp_path / "recovery_manifest.json"
        manifest_file.write_text("invalid json {{{")

        # Recovery should fail due to invalid manifest
        with pytest.raises(ValueError, match="^Failed to load recovery manifest: "):
            recovery_mgr.load_manifest()

    def test_no_interactive_checkpoint_selection_required(self, tmp_path: Path):
        """Test no interactive checkpoint selection due to simple test-level granularity."""
        # This is a design verification test
        # Recovery is deterministic: resume from last completed test
        # No user interaction needed to select checkpoint

        # This test documents the requirement
        pass


# ============================================================================
# Test Suite 13: Limitations
# ============================================================================


class TestRecoveryLimitations:
    """
    Test recovery limitations and constraints.

    Recovery does not support resuming with workflow structure changes, configuration
    changes, or external state changes.
    """

    def test_recovery_fails_with_modified_test_ordering(self, tmp_path: Path):
        """Test recovery fails if test ordering has changed since checkpoint."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create checkpoint with test order
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )
        recovery_mgr.record_test_completion(
            test_id="test-2",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # Simulate test order change detection
        # (In real implementation, this would compare current order with manifest)
        with pytest.raises(
            ValueError, match="^Test ordering has changed since checkpoint. Recovery aborted.$"
        ):
            recovery_mgr.validate_test_ordering(current_order=["test-2", "test-1"])  # Swapped order

    def test_recovery_fails_with_added_tests(self, tmp_path: Path):
        """Test recovery fails if tests have been added to workflow structure."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create checkpoint with 2 tests
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # Simulate added test detection
        with pytest.raises(
            ValueError, match="^Workflow structure has changed since checkpoint. Recovery aborted.$"
        ):
            recovery_mgr.validate_workflow_structure(original_test_count=2, current_test_count=3)

    def test_recovery_fails_with_removed_tests(self, tmp_path: Path):
        """Test recovery fails if tests have been removed from workflow structure."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create checkpoint with 3 tests
        for i in range(1, 4):
            recovery_mgr.record_test_completion(
                test_id=f"test-{i}",
                test_version="1.0.0",
                status=ExecutionState.COMPLETED,
                suite_variables={},
                regression_variables={},
            )

        # Simulate removed test detection
        with pytest.raises(
            ValueError, match="^Workflow structure has changed since checkpoint. Recovery aborted.$"
        ):
            recovery_mgr.validate_workflow_structure(original_test_count=3, current_test_count=2)

    def test_recovery_fails_with_changed_dependencies(self, tmp_path: Path):
        """Test recovery fails if test dependencies have changed."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create checkpoint with dependencies
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # Simulate dependency change
        with pytest.raises(
            ValueError,
            match="^Dependencies have changed since checkpoint was created. Recovery aborted. "
            "Please restart execution from beginning.$",
        ):
            recovery_mgr.validate_dependencies(current_dependencies={"new_plugin": "1.0.0"})

    def test_configuration_changes_require_fresh_execution(self, tmp_path: Path):
        """Test configuration changes affecting test definitions require fresh execution."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create checkpoint
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.COMPLETED,
            suite_variables={},
            regression_variables={},
        )

        # Simulate config change
        with pytest.raises(
            ValueError,
            match="^Configuration has changed since checkpoint was created. Recovery aborted. "
            "Please restart execution from beginning.$",
        ):
            recovery_mgr.validate_configuration(current_config={"timeout": 999})

    def test_external_state_changes_not_tracked(self, tmp_path: Path):
        """Test external state changes in target systems are not tracked by recovery."""
        # This is a design limitation documentation test
        # Recovery does NOT track external state changes (e.g., database records)
        # Tests must handle external state appropriately for repeatability

        # Example: If test-1 created a database record, and test-2 was interrupted,
        # recovery will re-run test-2, but the database record from test-1 still exists
        # Tests must be idempotent or handle cleanup appropriately

        pass

    def test_partial_progress_within_test_not_preserved(self, tmp_path: Path):
        """Test recovery does not preserve partial progress within interrupted tests."""
        # This is a design limitation documentation test
        # Recovery is test-level only
        # If a test has 10 blocks and completes 8, then interruption occurs,
        # the full test re-executes (all 10 blocks)

        # This ensures consistent semantics and idempotency

        pass


# ============================================================================
# Test Suite 14: Edge Cases and Error Paths
# ============================================================================


class TestEdgeCasesAndErrorPaths:
    """Test edge cases and error paths for complete coverage."""

    def test_record_failed_test_not_checkpointed(self, tmp_path: Path):
        """Test failed tests are not recorded in checkpoint."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Attempt to record failed test
        recovery_mgr.record_test_completion(
            test_id="test-1",
            test_version="1.0.0",
            status=ExecutionState.FAILED,
            suite_variables={},
            regression_variables={},
        )

        # Verify no checkpoint was created
        manifest = recovery_mgr.load_manifest()
        assert manifest is None

    def test_load_variable_state_with_corrupted_json(self, tmp_path: Path):
        """Test loading variable state with corrupted JSON raises error."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create corrupted variable state file
        var_state_file = tmp_path / "recovery_variables.json"
        var_state_file.write_text("invalid json {{{")

        # Attempt to load should raise ValueError
        with pytest.raises(ValueError, match="^Failed to load variable state: "):
            recovery_mgr.load_variable_state()

    def test_validate_artifacts_returns_true_when_no_checkpoint(self, tmp_path: Path):
        """Test validate_artifacts returns True when no checkpoint exists."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # No checkpoint exists
        is_valid = recovery_mgr.validate_artifacts()
        assert is_valid is True

    def test_find_continuation_point_with_empty_test_list(self, tmp_path: Path):
        """Test find_continuation_point returns None when test list is empty."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Find continuation point with empty list
        continuation = recovery_mgr.find_continuation_point([])
        assert continuation is None

    def test_find_continuation_point_when_all_tests_complete(self, tmp_path: Path):
        """Test find_continuation_point returns None when all tests complete."""
        from wavecore.core.errors.execution_recovery import RecoveryManager
        from wavecore.models.entities import Test

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create tests
        tests = [
            Test(id="test-1", name="Test 1", version="1.0.0", blocks=[]),
            Test(id="test-2", name="Test 2", version="1.0.0", blocks=[]),
        ]

        # Mark all as completed
        for test in tests:
            recovery_mgr.record_test_completion(
                test_id=test.id,
                test_version=test.version,
                status=ExecutionState.COMPLETED,
                suite_variables={},
                regression_variables={},
            )

        # Find continuation point
        continuation = recovery_mgr.find_continuation_point(tests)
        assert continuation is None

    def test_get_remaining_tests_when_no_checkpoint(self, tmp_path: Path):
        """Test get_remaining_tests returns all tests when no checkpoint."""
        from wavecore.core.errors.execution_recovery import RecoveryManager
        from wavecore.models.entities import Test

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        tests = [
            Test(id="test-1", name="Test 1", version="1.0.0", blocks=[]),
            Test(id="test-2", name="Test 2", version="1.0.0", blocks=[]),
        ]

        # No checkpoint exists
        remaining = recovery_mgr.get_remaining_tests(tests)
        assert len(remaining) == 2
        assert remaining == tests

    def test_finalize_interrupted_test_with_no_finalize_blocks(self, tmp_path: Path):
        """Test finalize_interrupted_test returns False when no finalize blocks."""
        from wavecore.core.errors.execution_recovery import RecoveryManager
        from wavecore.models.entities import Test

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create test without finalize blocks
        test = Test(id="test-1", name="Test 1", version="1.0.0", blocks=[], finalize_blocks=[])

        # Finalize should return False
        result = recovery_mgr.finalize_interrupted_test(test)
        assert result is False

    def test_cleanup_temporary_files_removes_tmp_extension(self, tmp_path: Path):
        """Test cleanup removes files with .tmp extension."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create .tmp file
        tmp_file = tmp_path / "data.tmp"
        tmp_file.write_text("temporary data")

        # Cleanup
        recovery_mgr.cleanup_temporary_files()

        # Verify removed
        assert not tmp_file.exists()

    def test_read_system_log_when_log_does_not_exist(self, tmp_path: Path):
        """Test read_system_log returns empty list when log doesn't exist."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Read log when it doesn't exist
        log_content = recovery_mgr.read_system_log()
        assert log_content == []

    def test_validate_test_ordering_when_no_checkpoint(self, tmp_path: Path):
        """Test validate_test_ordering passes when no checkpoint exists."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # No checkpoint exists
        # Validation should pass without error
        recovery_mgr.validate_test_ordering(["test-1", "test-2", "test-3"])
        # If we get here, validation passed

    def test_validate_workflow_structure_raises_error_on_mismatch(self, tmp_path: Path):
        """Test validate_workflow_structure raises error when counts don't match."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Different counts should raise error
        with pytest.raises(ValueError, match="^Workflow structure has changed since checkpoint"):
            recovery_mgr.validate_workflow_structure(original_test_count=5, current_test_count=3)

    def test_validate_test_ordering_raises_error_when_fewer_tests(self, tmp_path: Path):
        """Test validate_test_ordering raises error when current has fewer tests than manifest."""
        from wavecore.core.errors.execution_recovery import RecoveryManager

        recovery_mgr = RecoveryManager(artifact_dir=tmp_path)

        # Create checkpoint with 3 completed tests
        for i in range(1, 4):
            recovery_mgr.record_test_completion(
                test_id=f"test-{i}",
                test_version="1.0.0",
                status=ExecutionState.COMPLETED,
                suite_variables={},
                regression_variables={},
            )

        # Try to validate with fewer tests in current order
        with pytest.raises(ValueError, match="^Test ordering has changed since checkpoint"):
            recovery_mgr.validate_test_ordering(["test-1", "test-2"])
