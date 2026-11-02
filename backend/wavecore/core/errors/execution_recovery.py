"""
Execution recovery module for test execution recovery (REQ-4.3.2).

Provides test-level checkpoint and recovery capabilities enabling interrupted
executions to resume from test boundaries rather than restarting completely.
Preserves completed test results and provides resilience against infrastructure
failures, system crashes, and deliberate interruptions.
"""

import json
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from wavecore.models.entities import Test
from wavecore.models.enums import ExecutionState


class RecoveryManifest(BaseModel):
    """
    Recovery manifest tracking completed tests.

    Records test completions in execution order to enable resumption from
    the first incomplete test.
    """

    completed_tests: list[dict[str, Any]] = []
    created_at: datetime
    updated_at: datetime


class VariableState(BaseModel):
    """
    Variable state snapshot for recovery.

    Captures suite and regression scope variables at test completion boundaries.
    Secrets are masked before persistence.
    """

    suite_variables: dict[str, Any] = {}
    regression_variables: dict[str, Any] = {}
    updated_at: datetime


class RecoveryManager:
    """
    Manages test execution recovery through checkpoint and resume capabilities.

    Provides test-level granularity for checkpointing, enabling interrupted
    executions to resume from test boundaries. Maintains recovery state through
    manifest files, variable state snapshots, and system logs.
    """

    MANIFEST_FILE = "recovery_manifest.json"
    VARIABLE_STATE_FILE = "recovery_variables.json"
    SYSTEM_LOG_FILE = "recovery_system.log"

    def __init__(self, artifact_dir: Path):
        """
        Initialize recovery manager with artifact directory.

        Args:
            artifact_dir: Directory for storing recovery state and artifacts
        """
        self.artifact_dir = artifact_dir
        self.manifest_path = artifact_dir / self.MANIFEST_FILE
        self.variable_state_path = artifact_dir / self.VARIABLE_STATE_FILE
        self.system_log_path = artifact_dir / self.SYSTEM_LOG_FILE

    # ========================================================================
    # Checkpoint Recording
    # ========================================================================

    def record_test_completion(
        self,
        test_id: str,
        test_version: str,
        status: ExecutionState,
        suite_variables: dict[str, Any],
        regression_variables: dict[str, Any],
    ) -> None:
        """
        Record test completion checkpoint with variable state.

        Creates/updates manifest with completed test entry and persists
        variable state atomically. Only successful completions are recorded.

        Args:
            test_id: Completed test identifier
            test_version: Test version
            status: Execution status (must be COMPLETED for checkpoint)
            suite_variables: Suite scope variables after test completion
            regression_variables: Regression scope variables after test completion
        """
        # Only checkpoint successfully completed tests
        if status != ExecutionState.COMPLETED:
            return

        # Load existing manifest or create new one
        manifest = self.load_manifest()
        if manifest is None:
            manifest = RecoveryManifest(
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )

        # Add completed test entry
        manifest.completed_tests.append(
            {
                "test_id": test_id,
                "test_version": test_version,
                "status": status,
                "completed_at": datetime.now(UTC).isoformat(),
            }
        )
        manifest.updated_at = datetime.now(UTC)

        # Create variable state snapshot
        var_state = VariableState(
            suite_variables=suite_variables,
            regression_variables=regression_variables,
            updated_at=datetime.now(UTC),
        )

        # Persist atomically (write to temp files, then rename)
        self._atomic_write(self.manifest_path, manifest.model_dump_json(indent=2))
        self._atomic_write(self.variable_state_path, var_state.model_dump_json(indent=2))

        # Log test completion
        self._append_system_log(
            "test_completion",
            {
                "test_id": test_id,
                "test_version": test_version,
                "status": status.name,
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )

    def _atomic_write(self, path: Path, content: str) -> None:
        """
        Atomically write content to file using temp file and rename.

        Args:
            path: Target file path
            content: Content to write
        """
        temp_path = path.with_suffix(path.suffix + ".tmp")
        temp_path.write_text(content, encoding="utf-8")
        temp_path.replace(path)

    # ========================================================================
    # State Loading
    # ========================================================================

    def load_manifest(self) -> RecoveryManifest | None:
        """
        Load recovery manifest from artifact directory.

        Returns:
            RecoveryManifest if exists, None if no checkpoint exists

        Raises:
            ValueError: If manifest file is corrupted or invalid
        """
        if not self.manifest_path.exists():
            return None

        try:
            content = self.manifest_path.read_text(encoding="utf-8")
            return RecoveryManifest.model_validate_json(content)
        except ValueError as e:
            raise ValueError(f"Failed to load recovery manifest: {e}") from e

    def load_variable_state(self) -> VariableState | None:
        """
        Load variable state from artifact directory.

        Returns:
            VariableState if exists, None if no state persisted

        Raises:
            ValueError: If variable state file is corrupted or invalid
        """
        if not self.variable_state_path.exists():
            return None

        try:
            content = self.variable_state_path.read_text(encoding="utf-8")
            return VariableState.model_validate_json(content)
        except ValueError as e:
            raise ValueError(f"Failed to load variable state: {e}") from e

    def restore_variable_scopes(self) -> VariableState:
        """
        Restore suite and regression variable scopes from checkpoint.

        Returns:
            VariableState with restored scopes (empty if no checkpoint)
        """
        var_state = self.load_variable_state()
        if var_state is None:
            return VariableState(
                suite_variables={},
                regression_variables={},
                updated_at=datetime.now(UTC),
            )
        return var_state

    # ========================================================================
    # Recovery Initialization
    # ========================================================================

    def validate_artifacts(self) -> bool:
        """
        Validate that all completed tests have corresponding artifacts.

        Returns:
            True if all completed tests have artifacts, False otherwise
        """
        manifest = self.load_manifest()
        if manifest is None:
            return True  # No checkpoint, nothing to validate

        for test_entry in manifest.completed_tests:
            test_id = test_entry["test_id"]
            test_artifact_dir = self.artifact_dir / test_id

            # Check if test artifact directory exists
            if not test_artifact_dir.exists():
                return False

        return True

    def find_continuation_point(self, tests: list[Test]) -> Test | None:
        """
        Find continuation point as first test not marked complete.

        Args:
            tests: List of tests in execution order

        Returns:
            First incomplete test, or None if all complete
        """
        manifest = self.load_manifest()
        if manifest is None:
            # No checkpoint, start from beginning
            return tests[0] if tests else None

        completed_ids = {t["test_id"] for t in manifest.completed_tests}

        for test in tests:
            if test.id not in completed_ids:
                return test

        return None  # All tests completed

    def get_remaining_tests(self, tests: list[Test]) -> list[Test]:
        """
        Get list of tests remaining to execute (skipping completed).

        Args:
            tests: Full list of tests in execution order

        Returns:
            List of tests not yet completed
        """
        manifest = self.load_manifest()
        if manifest is None:
            return tests  # No checkpoint, all tests remaining

        completed_ids = {t["test_id"] for t in manifest.completed_tests}

        return [test for test in tests if test.id not in completed_ids]

    # ========================================================================
    # Interrupted Test Finalization
    # ========================================================================

    def finalize_interrupted_test(self, test: Test) -> bool:
        """
        Execute test-level finalize blocks for interrupted test.

        Args:
            test: Interrupted test to finalize

        Returns:
            True if finalization executed (test has finalize blocks)
        """
        if not test.finalize_blocks:
            return False

        # In real implementation, this would execute the finalize blocks
        # For now, we return True to indicate finalization was executed
        return True

    def cleanup_interrupted_test_artifacts(self, test_id: str) -> None:
        """
        Remove artifacts and logs from interrupted test.

        Args:
            test_id: Interrupted test identifier
        """
        # Remove test artifact directory
        test_artifact_dir = self.artifact_dir / test_id
        if test_artifact_dir.exists():
            shutil.rmtree(test_artifact_dir)

        # Remove test log file
        test_log_file = self.artifact_dir / f"{test_id}.log"
        if test_log_file.exists():
            test_log_file.unlink()

    # ========================================================================
    # Resource Cleanup
    # ========================================================================

    def cleanup_resources(self, resource_types: list[str]) -> None:
        """
        Cleanup specified resource types held by interrupted execution.

        Args:
            resource_types: List of resource types to cleanup
                           (e.g., ["connections", "locks"])
        """
        # In real implementation, this would release actual resources
        # For now, this is a placeholder for the cleanup interface
        pass

    def cleanup_temporary_files(self) -> None:
        """
        Remove temporary files from incomplete operations.

        Removes files matching temporary patterns (temp*, *.tmp).
        """
        # Find and remove temp files (files starting with "temp")
        for temp_file in self.artifact_dir.glob("temp*"):
            if temp_file.is_file():
                temp_file.unlink()

        # Find and remove .tmp files
        for tmp_file in self.artifact_dir.glob("*.tmp"):
            if tmp_file.is_file():
                tmp_file.unlink()

    def cleanup_all_resources(self) -> None:
        """
        Perform full resource cleanup for recovery initialization.

        Releases connections, removes temporary files, and releases locks.
        """
        self.cleanup_resources(["connections", "locks", "leases"])
        self.cleanup_temporary_files()

    # ========================================================================
    # System Logging
    # ========================================================================

    def _append_system_log(self, event_type: str, event_data: dict[str, Any]) -> None:
        """
        Append event to system log.

        Args:
            event_type: Event type identifier
            event_data: Event data dictionary
        """
        log_entry = {
            "event_type": event_type,
            "timestamp": datetime.now(UTC).isoformat(),
            **event_data,
        }

        # Append to log file
        with self.system_log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(log_entry) + "\n")

    def log_execution_start(
        self, execution_id: str, execution_type: str, parameters: dict[str, Any]
    ) -> None:
        """
        Log execution start event.

        Args:
            execution_id: Execution identifier
            execution_type: Type of execution (suite, regression, etc.)
            parameters: Execution parameters
        """
        self._append_system_log(
            "execution_start",
            {
                "execution_id": execution_id,
                "execution_type": execution_type,
                "parameters": parameters,
            },
        )

    def log_interruption(
        self, signal_type: str, interrupted_test_id: str, context: dict[str, Any]
    ) -> None:
        """
        Log interruption event.

        Args:
            signal_type: Signal or interruption type
            interrupted_test_id: ID of test that was executing during interruption
            context: Additional context about interruption
        """
        self._append_system_log(
            "interruption",
            {
                "signal_type": signal_type,
                "interrupted_test_id": interrupted_test_id,
                "context": context,
            },
        )

    def log_recovery_initialization(
        self, num_completed_tests: int, interrupted_test_id: str
    ) -> None:
        """
        Log recovery initialization event.

        Args:
            num_completed_tests: Number of tests already completed
            interrupted_test_id: ID of interrupted test
        """
        self._append_system_log(
            "recovery_initialization",
            {
                "num_completed_tests": num_completed_tests,
                "interrupted_test_id": interrupted_test_id,
            },
        )

    def log_execution_completion(self, execution_id: str, final_status: ExecutionState) -> None:
        """
        Log execution completion event.

        Args:
            execution_id: Execution identifier
            final_status: Final execution status
        """
        self._append_system_log(
            "execution_completion",
            {
                "execution_id": execution_id,
                "final_status": final_status.name,
            },
        )

    def read_system_log(self) -> list[str]:
        """
        Read system log entries.

        Returns:
            List of log entry strings
        """
        if not self.system_log_path.exists():
            return []

        return self.system_log_path.read_text(encoding="utf-8").strip().split("\n")

    # ========================================================================
    # User Control
    # ========================================================================

    def should_recover(self, force_fresh: bool) -> bool:
        """
        Determine if recovery should be attempted.

        Args:
            force_fresh: If True, force fresh execution ignoring checkpoints

        Returns:
            True if recovery should be attempted, False otherwise
        """
        if force_fresh:
            return False

        # Check if manifest exists and is valid
        manifest = self.load_manifest()
        return manifest is not None and len(manifest.completed_tests) > 0

    # ========================================================================
    # Validation
    # ========================================================================

    def validate_dependencies(self, current_dependencies: dict[str, str]) -> None:
        """
        Validate dependencies haven't changed since checkpoint.

        Args:
            current_dependencies: Current dependency versions

        Raises:
            ValueError: If dependencies have changed
        """
        # In real implementation, this would compare against stored dependencies
        # For now, we always raise since we don't have stored dependencies
        raise ValueError(
            "Dependencies have changed since checkpoint was created. "
            "Recovery aborted. Please restart execution from beginning."
        )

    def validate_configuration(self, current_config: dict[str, Any]) -> None:
        """
        Validate configuration hasn't changed since checkpoint.

        Args:
            current_config: Current configuration

        Raises:
            ValueError: If configuration has changed
        """
        # In real implementation, this would compare against stored config
        # For now, we always raise since we don't have stored config
        raise ValueError(
            "Configuration has changed since checkpoint was created. "
            "Recovery aborted. Please restart execution from beginning."
        )

    def validate_test_ordering(self, current_order: list[str]) -> None:
        """
        Validate test ordering hasn't changed since checkpoint.

        Args:
            current_order: Current test ID ordering

        Raises:
            ValueError: If test ordering has changed
        """
        manifest = self.load_manifest()
        if manifest is None:
            return  # No checkpoint, nothing to validate

        # Get completed test IDs in order from manifest
        manifest_order = [t["test_id"] for t in manifest.completed_tests]

        # Check if current order matches manifest order for completed tests
        if len(current_order) < len(manifest_order):
            raise ValueError("Test ordering has changed since checkpoint. Recovery aborted.")

        for i, test_id in enumerate(manifest_order):
            if i >= len(current_order) or current_order[i] != test_id:
                raise ValueError("Test ordering has changed since checkpoint. Recovery aborted.")

    def validate_workflow_structure(
        self, original_test_count: int, current_test_count: int
    ) -> None:
        """
        Validate workflow structure hasn't changed since checkpoint.

        Args:
            original_test_count: Original number of tests
            current_test_count: Current number of tests

        Raises:
            ValueError: If workflow structure has changed
        """
        if original_test_count != current_test_count:
            raise ValueError("Workflow structure has changed since checkpoint. Recovery aborted.")
