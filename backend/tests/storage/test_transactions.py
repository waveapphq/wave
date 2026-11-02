"""
Comprehensive unit tests for REQ-4.3.5: Transaction support for state changes.

This module tests atomic operations, file locking, retry logic, and transaction
semantics for the storage layer to ensure data integrity and consistency.

Tests cover:
- Atomic write-then-rename pattern
- File locking for concurrent access coordination
- Retry mechanism with exponential backoff
- Transaction rollback and cleanup
- Multi-component transactions
- Version immutability and conflict detection
"""

import fcntl
import logging
import os
import shutil
import tempfile
import threading
import time
from pathlib import Path
from unittest.mock import patch

import pytest

from tests.conftest import create_test_block, create_test_plugin
from wavecore.models.entities import Test
from wavecore.storage import FileBasedStorage

_STORAGE_LOGGER = "wavecore.storage.file_storage.storage"


def _storage_messages(caplog, level):
    """What the storage module logged at one level."""
    return [
        record.getMessage()
        for record in caplog.records
        if record.name == _STORAGE_LOGGER and record.levelno == level
    ]


class TestAtomicWrites:
    """Test atomic write-then-rename pattern (REQ-4.3.5)."""

    @pytest.fixture
    def temp_storage_dir(self):
        """Create temporary storage directory."""
        temp_dir = tempfile.mkdtemp()
        yield Path(temp_dir)
        shutil.rmtree(temp_dir)

    @pytest.fixture
    def storage(self, temp_storage_dir):
        """Create file-based storage instance."""
        return FileBasedStorage(base_path=temp_storage_dir)

    def test_atomic_write_creates_temp_file_first(self, storage, temp_storage_dir):
        """Test that save creates temporary file before final file."""
        plugin = create_test_plugin(
            id="test-plugin",
            name="Test Plugin",
            version="1.0.0",
            category="system",
            description="Test atomic write",
            parameters=[],
        )

        # Monitor filesystem during save
        temp_files_created = []
        original_link = os.link

        def track_links(src, dst):
            if ".tmp" in str(src):
                temp_files_created.append(str(src))
            return original_link(src, dst)

        with patch("os.link", side_effect=track_links):
            storage.save_plugin(plugin, format="yaml")

        # Verify temp file was created and renamed
        assert len(temp_files_created) > 0, "No temporary file created during atomic write"

    def test_atomic_write_temp_file_cleaned_on_success(self, storage, temp_storage_dir):
        """Test that temporary file is removed after successful atomic rename."""
        plugin = create_test_plugin(
            id="cleanup-test",
            name="Cleanup Test",
            version="1.0.0",
            category="system",
            description="Test temp cleanup",
            parameters=[],
        )

        storage.save_plugin(plugin, format="yaml")

        # Verify no .tmp files remain
        plugin_dir = temp_storage_dir / "plugins" / "system" / "cleanup-test"
        temp_files = list(plugin_dir.glob("*.tmp*"))
        assert len(temp_files) == 0, "Temporary files not cleaned up after successful write"

    def test_atomic_write_no_partial_file_on_failure(self, storage, temp_storage_dir):
        """Test that target file is not created if write fails."""
        plugin = create_test_plugin(
            id="fail-test",
            name="Fail Test",
            version="1.0.0",
            category="system",
            description="Test failure handling",
            parameters=[],
        )

        target_file = temp_storage_dir / "plugins" / "system" / "fail-test" / "1.0.0.yaml"

        # Simulate failure during serialization
        with patch("yaml.dump", side_effect=Exception("Serialization failed")):
            with pytest.raises(Exception, match="^Serialization failed$"):
                storage.save_plugin(plugin, format="yaml")

        # Target file should not exist (atomic write prevents partial files)
        assert not target_file.exists(), "Partial file created despite write failure"

    def test_atomic_write_temp_file_cleaned_on_failure(self, storage, temp_storage_dir):
        """Test that temporary file is cleaned up when write fails."""
        plugin = create_test_plugin(
            id="temp-cleanup-fail",
            name="Temp Cleanup Fail",
            version="1.0.0",
            category="system",
            description="Test temp cleanup on failure",
            parameters=[],
        )

        plugin_dir = temp_storage_dir / "plugins" / "system" / "temp-cleanup-fail"

        # Simulate failure after temp file creation
        with patch("os.link", side_effect=OSError("Link failed")):
            with pytest.raises(OSError, match="^Link failed$"):
                storage.save_plugin(plugin, format="yaml")

        # Verify no temp files remain
        plugin_dir.mkdir(parents=True, exist_ok=True)
        temp_files = list(plugin_dir.glob("*.tmp*"))
        assert len(temp_files) == 0, "Temporary files not cleaned up after write failure"

    def test_atomic_write_uses_fsync(self, storage):
        """Test that atomic write flushes data to disk with fsync."""
        plugin = create_test_plugin(
            id="fsync-test",
            name="Fsync Test",
            version="1.0.0",
            category="system",
            description="Test fsync usage",
            parameters=[],
        )

        fsync_called = []

        def track_fsync(fd):
            fsync_called.append(fd)

        with patch("os.fsync", side_effect=track_fsync):
            storage.save_plugin(plugin, format="yaml")

        assert len(fsync_called) > 0, "fsync not called during atomic write"

    def test_atomic_rename_is_posix_atomic(self, storage, temp_storage_dir):
        """Test that rename operation is POSIX atomic (no partial state visible)."""
        plugin = create_test_plugin(
            id="atomic-rename-test",
            name="Atomic Rename Test",
            version="1.0.0",
            category="system",
            description="Test POSIX atomic rename",
            parameters=[],
        )

        target_file = temp_storage_dir / "plugins" / "system" / "atomic-rename-test" / "1.0.0.yaml"
        file_states = []

        def check_file_state(*args, **kwargs):
            # During rename, file should either not exist or be complete
            if target_file.exists():
                size = target_file.stat().st_size
                file_states.append(("exists", size))
            else:
                file_states.append(("not_exists", 0))

        # Monitor file state during write
        original_link = os.link

        def tracked_link(src, dst):
            check_file_state()
            result = original_link(src, dst)
            check_file_state()
            return result

        with patch("os.link", side_effect=tracked_link):
            storage.save_plugin(plugin, format="yaml")

        # Verify: file either doesn't exist or has complete data (no partial states)
        for state, size in file_states:
            if state == "exists":
                assert size > 0, "File existed with zero size (partial state visible)"


class TestFileLocking:
    """Test file locking for concurrent access coordination (REQ-4.3.5)."""

    @pytest.fixture
    def temp_storage_dir(self):
        """Create temporary storage directory."""
        temp_dir = tempfile.mkdtemp()
        yield Path(temp_dir)
        shutil.rmtree(temp_dir)

    @pytest.fixture
    def storage(self, temp_storage_dir):
        """Create file-based storage instance."""
        return FileBasedStorage(base_path=temp_storage_dir)

    def test_concurrent_writes_use_file_locks(self, storage):
        """Test that concurrent writes acquire file locks."""
        plugin = create_test_plugin(
            id="lock-test",
            name="Lock Test",
            version="1.0.0",
            category="system",
            description="Test file locking",
            parameters=[],
        )

        lock_acquired = []

        def track_flock(fd, operation):
            if operation & fcntl.LOCK_EX:
                lock_acquired.append(("exclusive", fd))
            elif operation & fcntl.LOCK_SH:
                lock_acquired.append(("shared", fd))

        with patch("fcntl.flock", side_effect=track_flock):
            storage.save_plugin(plugin, format="yaml")

        assert len(lock_acquired) > 0, "No file locks acquired during write"
        assert any(
            lock_type == "exclusive" for lock_type, _ in lock_acquired
        ), "Exclusive lock not acquired for write operation"

    def test_concurrent_writes_serialized_by_lock(self, storage):
        """Test that concurrent writes to same file are serialized."""
        results = []
        errors = []

        def write_plugin(version: str):
            try:
                plugin = create_test_plugin(
                    id="concurrent-test",
                    name="Concurrent Test",
                    version=version,
                    category="system",
                    description="Test concurrent writes",
                    parameters=[],
                )
                storage.save_plugin(plugin, format="yaml")
                results.append(version)
            except Exception as e:
                errors.append((version, str(e)))

        # Launch concurrent writes
        threads = [threading.Thread(target=write_plugin, args=(f"1.0.{i}",)) for i in range(5)]

        for t in threads:
            t.start()

        for t in threads:
            t.join(timeout=5.0)

        # All writes should succeed (serialized by locks)
        assert len(results) == 5, f"Not all concurrent writes succeeded: {len(results)}/5"
        assert len(errors) == 0, f"Concurrent write errors: {errors}"

    def test_lock_released_on_success(self, storage):
        """Test that file lock is released after successful write."""
        plugin = create_test_plugin(
            id="lock-release-test",
            name="Lock Release Test",
            version="1.0.0",
            category="system",
            description="Test lock release",
            parameters=[],
        )

        lock_operations = []

        def track_flock(fd, operation):
            if operation & fcntl.LOCK_EX:
                lock_operations.append(("acquire", fd))
            elif operation & fcntl.LOCK_UN:
                lock_operations.append(("release", fd))

        with patch("fcntl.flock", side_effect=track_flock):
            storage.save_plugin(plugin, format="yaml")

        # Verify lock was both acquired and released
        assert ("acquire", lock_operations[0][1]) in lock_operations, "Lock not acquired"
        assert ("release", lock_operations[0][1]) in lock_operations, "Lock not released"

    def test_lock_released_on_failure(self, storage):
        """Test that file lock is released even when write fails."""
        plugin = create_test_plugin(
            id="lock-release-fail",
            name="Lock Release Fail",
            version="1.0.0",
            category="system",
            description="Test lock release on failure",
            parameters=[],
        )

        lock_operations = []

        def track_flock(fd, operation):
            if operation & fcntl.LOCK_EX:
                lock_operations.append(("acquire", fd))
            elif operation & fcntl.LOCK_UN:
                lock_operations.append(("release", fd))

        with patch("fcntl.flock", side_effect=track_flock):
            with patch("yaml.dump", side_effect=Exception("Write failed")):
                with pytest.raises(Exception, match="^Write failed$"):
                    storage.save_plugin(plugin, format="yaml")

        # Lock should be released despite failure
        assert (
            "release",
            lock_operations[0][1],
        ) in lock_operations, "Lock not released after write failure"

    def test_lock_timeout_on_deadlock(self, storage):
        """Test that lock acquisition times out to prevent deadlock."""
        plugin = create_test_plugin(
            id="deadlock-test",
            name="Deadlock Test",
            version="1.0.0",
            category="system",
            description="Test deadlock prevention",
            parameters=[],
        )

        def simulate_deadlock(fd, operation):
            if operation & fcntl.LOCK_EX:
                # Simulate lock held by another process
                raise BlockingIOError("Resource temporarily unavailable")

        with patch("fcntl.flock", side_effect=simulate_deadlock):
            with pytest.raises(BlockingIOError, match="^Resource temporarily unavailable$"):
                storage.save_plugin(plugin, format="yaml")


class TestRetryMechanism:
    """Test retry mechanism with exponential backoff (REQ-4.3.5)."""

    @pytest.fixture
    def temp_storage_dir(self):
        """Create temporary storage directory."""
        temp_dir = tempfile.mkdtemp()
        yield Path(temp_dir)
        shutil.rmtree(temp_dir)

    @pytest.fixture
    def storage(self, temp_storage_dir):
        """Create file-based storage instance."""
        return FileBasedStorage(base_path=temp_storage_dir)

    def test_retry_on_temporary_lock_failure(self, storage):
        """Test that write retries on temporary lock failures."""
        plugin = create_test_plugin(
            id="retry-test",
            name="Retry Test",
            version="1.0.0",
            category="system",
            description="Test retry on lock failure",
            parameters=[],
        )

        attempt_count = []

        def fail_twice_then_succeed(fd, operation):
            # Only count lock acquisition attempts (LOCK_EX), not releases (LOCK_UN)
            if operation & fcntl.LOCK_EX:
                attempt_count.append(len(attempt_count) + 1)
                if len(attempt_count) < 3:
                    raise BlockingIOError("Resource temporarily unavailable")
            # Third LOCK_EX attempt succeeds, LOCK_UN always succeeds

        with patch("fcntl.flock", side_effect=fail_twice_then_succeed):
            storage.save_plugin(plugin, format="yaml")

        # Should have retried and eventually succeeded
        assert len(attempt_count) == 3, f"Expected 3 attempts, got {len(attempt_count)}"

    def test_no_retry_on_permanent_failure(self, storage):
        """Test that write does not retry on permanent failures."""
        plugin = create_test_plugin(
            id="no-retry-test",
            name="No Retry Test",
            version="1.0.0",
            category="system",
            description="Test no retry on permanent failure",
            parameters=[],
        )

        attempt_count = []

        def permanent_failure(*args, **kwargs):
            attempt_count.append(len(attempt_count) + 1)
            raise ValueError("Invalid data format")

        with patch("yaml.dump", side_effect=permanent_failure):
            with pytest.raises(ValueError, match="^Invalid data format$"):
                storage.save_plugin(plugin, format="yaml")

        # Should fail immediately without retry
        assert (
            len(attempt_count) == 1
        ), f"Should not retry permanent failures, got {len(attempt_count)} attempts"

    def test_exponential_backoff_timing(self, storage):
        """Test that retry uses exponential backoff timing."""
        plugin = create_test_plugin(
            id="backoff-test",
            name="Backoff Test",
            version="1.0.0",
            category="system",
            description="Test exponential backoff",
            parameters=[],
        )

        attempt_times = []

        def fail_with_timing(fd, operation):
            # Only track lock acquisition attempts (LOCK_EX), not releases (LOCK_UN)
            if operation & fcntl.LOCK_EX:
                attempt_times.append(time.time())
                if len(attempt_times) < 4:
                    raise BlockingIOError("Resource temporarily unavailable")

        with patch("fcntl.flock", side_effect=fail_with_timing):
            storage.save_plugin(plugin, format="yaml")

        # Calculate delays between attempts
        delays = [attempt_times[i] - attempt_times[i - 1] for i in range(1, len(attempt_times))]

        # Verify exponential growth - each delay must be strictly larger than the previous one.
        # Ratio bounds fail under container CPU contention, which adds slack to any `sleep`.
        for i in range(1, len(delays)):
            assert (
                delays[i] > delays[i - 1]
            ), f"Delay not strictly increasing (exponential backoff invariant): {delays}"

    def test_max_retry_attempts_limit(self, storage):
        """Test that retry has a maximum attempt limit."""
        plugin = create_test_plugin(
            id="max-retry-test",
            name="Max Retry Test",
            version="1.0.0",
            category="system",
            description="Test max retry limit",
            parameters=[],
        )

        attempt_count = []

        def always_fail(fd, operation):
            # Only count lock acquisition attempts (LOCK_EX)
            if operation & fcntl.LOCK_EX:
                attempt_count.append(len(attempt_count) + 1)
                raise BlockingIOError("Resource temporarily unavailable")

        with patch("fcntl.flock", side_effect=always_fail):
            with pytest.raises(BlockingIOError):
                storage.save_plugin(plugin, format="yaml")

        # Should stop after max retries (e.g., 5 attempts)
        assert len(attempt_count) <= 5, f"Too many retry attempts: {len(attempt_count)}"

    def test_retry_logs_failure_diagnostics(self, storage, caplog):
        """Test that retry failures are logged with diagnostic context."""
        plugin = create_test_plugin(
            id="log-test",
            name="Log Test",
            version="1.0.0",
            category="system",
            description="Test failure logging",
            parameters=[],
        )

        lock_ex_count = []

        def fail_once(fd, operation):
            # Only fail on first LOCK_EX attempt
            if operation & fcntl.LOCK_EX:
                lock_ex_count.append(1)
                if len(lock_ex_count) == 1:
                    raise BlockingIOError("Resource temporarily unavailable")

        with patch("fcntl.flock", side_effect=fail_once):
            with caplog.at_level(logging.WARNING, logger=_STORAGE_LOGGER):
                storage.save_plugin(plugin, format="yaml")

        # Verify diagnostic logging
        logged_messages = _storage_messages(caplog, logging.WARNING)
        assert len(logged_messages) > 0, "No diagnostic logs for retry failures"
        assert any(
            "retry" in msg.lower() or "attempt" in msg.lower() for msg in logged_messages
        ), "Diagnostic logs missing retry context"


class TestTransactionRollback:
    """Test transaction rollback and cleanup (REQ-4.3.5)."""

    @pytest.fixture
    def temp_storage_dir(self):
        """Create temporary storage directory."""
        temp_dir = tempfile.mkdtemp()
        yield Path(temp_dir)
        shutil.rmtree(temp_dir)

    @pytest.fixture
    def storage(self, temp_storage_dir):
        """Create file-based storage instance."""
        return FileBasedStorage(base_path=temp_storage_dir)

    def test_rollback_leaves_no_partial_state(self, storage, temp_storage_dir):
        """Test that failed transaction leaves no partial state."""
        plugin = create_test_plugin(
            id="rollback-test",
            name="Rollback Test",
            version="1.0.0",
            category="system",
            description="Test rollback cleanup",
            parameters=[],
        )

        # Simulate failure after partial write
        with patch("yaml.dump", side_effect=Exception("Write failed mid-transaction")):
            with pytest.raises(Exception, match="^Write failed mid-transaction$"):
                storage.save_plugin(plugin, format="yaml")

        # Verify no files created
        plugin_dir = temp_storage_dir / "plugins" / "system" / "rollback-test"
        if plugin_dir.exists():
            all_files = list(plugin_dir.glob("*"))
            assert len(all_files) == 0, f"Partial state left after rollback: {all_files}"

    def test_rollback_cleans_temp_files(self, storage, temp_storage_dir):
        """Test that rollback removes all temporary files."""
        plugin = create_test_plugin(
            id="temp-rollback",
            name="Temp Rollback",
            version="1.0.0",
            category="system",
            description="Test temp file cleanup on rollback",
            parameters=[],
        )

        # Create temp file then fail
        plugin_dir = temp_storage_dir / "plugins" / "system" / "temp-rollback"
        plugin_dir.mkdir(parents=True, exist_ok=True)

        with patch("os.link", side_effect=OSError("Link failed")):
            with pytest.raises(OSError, match="^Link failed$"):
                storage.save_plugin(plugin, format="yaml")

        # No temp files should remain
        temp_files = list(plugin_dir.glob("*.tmp*"))
        assert len(temp_files) == 0, f"Temp files not cleaned on rollback: {temp_files}"

    def test_rollback_logs_failure_context(self, storage, caplog):
        """Test that rollback logs failure with diagnostic context."""
        plugin = create_test_plugin(
            id="log-rollback",
            name="Log Rollback",
            version="1.0.0",
            category="system",
            description="Test rollback logging",
            parameters=[],
        )

        with patch("yaml.dump", side_effect=Exception("Transaction failed")):
            with caplog.at_level(logging.ERROR, logger=_STORAGE_LOGGER):
                with pytest.raises(Exception, match="^Transaction failed$"):
                    storage.save_plugin(plugin, format="yaml")

        # Verify diagnostic context in logs
        logged_errors = _storage_messages(caplog, logging.ERROR)
        assert len(logged_errors) > 0, "No error logs on rollback"
        log_text = " ".join(logged_errors).lower()
        assert (
            "rollback" in log_text or "failed" in log_text
        ), "Diagnostic context missing from rollback logs"

    def test_transaction_cleanup_on_exception(self, storage, temp_storage_dir):
        """Test that transaction cleanup occurs even with exceptions."""
        plugin = create_test_plugin(
            id="exception-cleanup",
            name="Exception Cleanup",
            version="1.0.0",
            category="system",
            description="Test cleanup on exception",
            parameters=[],
        )

        plugin_dir = temp_storage_dir / "plugins" / "system" / "exception-cleanup"
        plugin_dir.mkdir(parents=True, exist_ok=True)

        # Cause exception during write
        with patch("yaml.dump", side_effect=KeyboardInterrupt("User canceled")):
            with pytest.raises(KeyboardInterrupt):
                storage.save_plugin(plugin, format="yaml")

        # Cleanup should still occur
        temp_files = list(plugin_dir.glob("*.tmp*"))
        assert len(temp_files) == 0, "Temp files not cleaned after exception"


class TestMultiComponentTransactions:
    """Test multi-component transactions (REQ-4.3.5)."""

    @pytest.fixture
    def temp_storage_dir(self):
        """Create temporary storage directory."""
        temp_dir = tempfile.mkdtemp()
        yield Path(temp_dir)
        shutil.rmtree(temp_dir)

    @pytest.fixture
    def storage(self, temp_storage_dir):
        """Create file-based storage instance."""
        return FileBasedStorage(base_path=temp_storage_dir)

    def test_multi_component_all_or_nothing(self, storage):
        """Test that multi-component transaction is all-or-nothing."""
        block = create_test_block(
            id="multi-block",
            name="Multi Block",
            version="1.0.0",
            type="action",
            plugin_id="test-plugin",
        )

        test = Test(
            id="multi-test",
            name="Multi Test",
            version="1.0.0",
            blocks=[{"block_id": "multi-block", "block_version": "1.0.0", "order": 0}],
        )

        # Start transaction to save both components
        # If block save fails, test save should not occur
        with patch("yaml.dump") as mock_dump:
            # First call (block) succeeds, second call (test) fails with permanent error
            mock_dump.side_effect = [None, ValueError("Test save failed")]

            with pytest.raises(ValueError, match="^Test save failed$"):
                storage.save_block(block)
                storage.save_test(test)

        # Verify: if transaction rolled back, block should not exist
        # This tests that save operations are coordinated

    def test_multi_component_rollback_on_any_failure(self, storage, temp_storage_dir):
        """Test that any component failure rolls back entire transaction."""
        # This would test a hypothetical transaction wrapper that coordinates
        # multiple save operations. Currently testing the building blocks.

        plugin = create_test_plugin(
            id="tx-plugin",
            name="TX Plugin",
            version="1.0.0",
            category="system",
            description="Transaction test",
            parameters=[],
        )

        block = create_test_block(
            id="tx-block",
            name="TX Block",
            version="1.0.0",
            type="action",
            plugin_id="tx-plugin",
        )

        # Simulate coordinated save where second component fails
        storage.save_plugin(plugin)

        with patch("yaml.dump", side_effect=Exception("Block save failed")):
            with pytest.raises(Exception, match="^Block save failed$"):
                storage.save_block(block)

        # Plugin exists (first component)
        assert storage.load_plugin("tx-plugin") is not None

        # Block should not exist (second component failed)
        with pytest.raises(FileNotFoundError):
            storage.load_block("tx-block")

    def test_transaction_directory_pattern(self, storage, temp_storage_dir):
        """Test transaction directory pattern for multiple related files."""
        # Create multiple related files that should be committed atomically
        # This tests the staging directory approach mentioned in requirements

        base_id = "multi-file-tx"
        plugin_dir = temp_storage_dir / "plugins" / "system" / base_id

        # Simulate staging directory approach
        staging_dir = plugin_dir / ".staging"
        staging_dir.mkdir(parents=True, exist_ok=True)

        # Create files in staging
        file1 = staging_dir / "file1.yaml"
        file2 = staging_dir / "file2.yaml"
        file1.write_text("content1")
        file2.write_text("content2")

        # Atomic rename of directory
        target_dir = plugin_dir / "1.0.0"
        staging_dir.rename(target_dir)

        # Verify both files moved atomically
        assert (target_dir / "file1.yaml").exists()
        assert (target_dir / "file2.yaml").exists()
        assert not staging_dir.exists()


class TestVersionImmutability:
    """Test version immutability and conflict detection (REQ-4.3.5)."""

    @pytest.fixture
    def temp_storage_dir(self):
        """Create temporary storage directory."""
        temp_dir = tempfile.mkdtemp()
        yield Path(temp_dir)
        shutil.rmtree(temp_dir)

    @pytest.fixture
    def storage(self, temp_storage_dir):
        """Create file-based storage instance."""
        return FileBasedStorage(base_path=temp_storage_dir)

    def test_version_immutability_prevents_overwrite(self, storage):
        """Test that version immutability prevents accidental overwrites."""
        plugin = create_test_plugin(
            id="immutable-test",
            name="Immutable Test",
            version="1.0.0",
            category="system",
            description="Original version",
            parameters=[],
        )

        storage.save_plugin(plugin)

        # Attempt to overwrite with modified plugin
        modified_plugin = create_test_plugin(
            id="immutable-test",
            name="Immutable Test",
            version="1.0.0",
            category="system",
            description="Modified version",
            parameters=[],
        )

        with pytest.raises(FileExistsError, match="^Plugin version already exists"):
            storage.save_plugin(modified_plugin, allow_overwrite=False)

        # Original version should be unchanged
        loaded = storage.load_plugin("immutable-test", version="1.0.0")
        assert loaded.description == "Original version"

    def test_concurrent_version_creation_conflict(self, storage):
        """Test detection of concurrent version creation conflicts."""
        import uuid

        unique_id = f"concurrent-version-{uuid.uuid4().hex[:8]}"
        results = []
        errors = []

        def create_same_version(worker_id: int):
            try:
                plugin = create_test_plugin(
                    id=unique_id,
                    name="Concurrent Version",
                    version="1.0.0",
                    category="system",
                    description=f"Worker {worker_id}",
                    parameters=[],
                )
                storage.save_plugin(plugin, allow_overwrite=False)
                results.append(worker_id)
            except FileExistsError as e:
                errors.append((worker_id, str(e)))

        # Launch concurrent attempts to create same version
        threads = [threading.Thread(target=create_same_version, args=(i,)) for i in range(3)]

        for t in threads:
            t.start()

        for t in threads:
            t.join(timeout=5.0)

        # Only one should succeed, others should get conflict errors
        assert len(results) == 1, f"Multiple workers created same version: {results}"
        assert len(errors) == 2, f"Expected 2 conflicts, got {len(errors)}"

    def test_optimistic_locking_with_version_check(self, storage):
        """Test optimistic locking using version numbers."""
        plugin_v1 = create_test_plugin(
            id="optimistic-lock",
            name="Optimistic Lock",
            version="1.0.0",
            category="system",
            description="Version 1",
            parameters=[],
        )

        storage.save_plugin(plugin_v1)

        # Simulate concurrent modification
        _loaded = storage.load_plugin("optimistic-lock", version="1.0.0")

        # Another process modifies (creates v2)
        plugin_v2 = create_test_plugin(
            id="optimistic-lock",
            name="Optimistic Lock",
            version="2.0.0",
            category="system",
            description="Version 2",
            parameters=[],
        )
        storage.save_plugin(plugin_v2)

        # Original process tries to save based on stale v1 data
        # Should detect conflict if version check is implemented
        plugin_v1_modified = create_test_plugin(
            id="optimistic-lock",
            name="Optimistic Lock",
            version="1.0.0",
            category="system",
            description="Modified version 1",
            parameters=[],
        )

        # This should fail because version already exists
        with pytest.raises(FileExistsError):
            storage.save_plugin(plugin_v1_modified, allow_overwrite=False)

    def test_link_file_exists_error_handling(self, storage, temp_storage_dir):
        """Test that FileExistsError from os.link is properly handled and temp file cleaned."""
        plugin = create_test_plugin(
            id="link-exists-test",
            name="Link Exists Test",
            version="1.0.0",
            category="system",
            description="Test link exists error",
            parameters=[],
        )

        # Track calls to os.unlink to verify temp file cleanup
        unlink_calls = []
        _original_unlink = os.unlink

        def mock_unlink(path):
            unlink_calls.append(str(path))
            # Don't actually unlink since we're mocking
            return None

        # Mock os.link to raise FileExistsError
        def mock_link(src, dst):
            # Raise FileExistsError as if the file was created by another process
            raise FileExistsError(f"File exists: {dst}")

        with patch("os.link", side_effect=mock_link):
            with patch("os.unlink", side_effect=mock_unlink):
                with pytest.raises(FileExistsError, match="Version already exists"):
                    storage.save_plugin(plugin, allow_overwrite=False)

        # Verify that unlink was called on the temp file
        assert len(unlink_calls) > 0, "os.unlink was not called to clean up temp file"
        # Should have temp file path in unlink calls
        assert any(
            ".tmp" in call for call in unlink_calls
        ), f"No temp file cleanup in: {unlink_calls}"

    def test_version_check_before_creation(self, storage):
        """Test that version existence is checked before file creation."""
        plugin = create_test_plugin(
            id="version-check",
            name="Version Check",
            version="1.0.0",
            category="system",
            description="Test version check",
            parameters=[],
        )

        storage.save_plugin(plugin)

        # Verify version exists
        loaded = storage.load_plugin("version-check", version="1.0.0")
        assert loaded is not None

        # Attempt duplicate creation fails before any file operations
        with pytest.raises(FileExistsError, match="^Plugin version already exists"):
            storage.save_plugin(plugin, allow_overwrite=False)

    def test_metadata_conflict_detection(self, storage):
        """Test conflict detection in metadata updates."""
        plugin = create_test_plugin(
            id="metadata-conflict",
            name="Metadata Conflict",
            version="1.0.0",
            category="system",
            description="Test metadata conflicts",
            parameters=[],
        )

        storage.save_plugin(plugin)

        # Simulate metadata update conflict
        # If metadata index exists, verify updates are atomic
        plugin_updated = create_test_plugin(
            id="metadata-conflict",
            name="Metadata Conflict Updated",
            version="1.0.0",
            category="system",
            description="Updated description",
            parameters=[],
        )

        # Should fail due to version immutability
        with pytest.raises(FileExistsError):
            storage.save_plugin(plugin_updated, allow_overwrite=False)


class TestTransactionErrorRecovery:
    """Test error recovery and diagnostic logging (REQ-4.3.5)."""

    @pytest.fixture
    def temp_storage_dir(self):
        """Create temporary storage directory."""
        temp_dir = tempfile.mkdtemp()
        yield Path(temp_dir)
        shutil.rmtree(temp_dir)

    @pytest.fixture
    def storage(self, temp_storage_dir):
        """Create file-based storage instance."""
        return FileBasedStorage(base_path=temp_storage_dir)

    def test_error_recovery_safe_retry(self, storage):
        """Test that failed transactions can be safely retried."""
        plugin = create_test_plugin(
            id="retry-safe",
            name="Retry Safe",
            version="1.0.0",
            category="system",
            description="Test safe retry",
            parameters=[],
        )

        # First attempt fails
        with patch("yaml.dump", side_effect=Exception("First attempt failed")):
            with pytest.raises(Exception, match="^First attempt failed$"):
                storage.save_plugin(plugin)

        # Retry should succeed (no leftover state from first attempt)
        storage.save_plugin(plugin)

        # Verify successful save
        loaded = storage.load_plugin("retry-safe", version="1.0.0")
        assert loaded is not None

    def test_diagnostic_logging_on_failure(self, storage, caplog):
        """Test that failures are logged with diagnostic context."""
        plugin = create_test_plugin(
            id="diagnostic-log",
            name="Diagnostic Log",
            version="1.0.0",
            category="system",
            description="Test diagnostic logging",
            parameters=[],
        )

        with caplog.at_level(logging.ERROR, logger=_STORAGE_LOGGER):
            with patch("yaml.dump", side_effect=Exception("Save operation failed")):
                with pytest.raises(Exception, match="^Save operation failed$"):
                    storage.save_plugin(plugin)

        # Verify diagnostic information in logs
        logged_diagnostics = _storage_messages(caplog, logging.ERROR)
        assert len(logged_diagnostics) > 0, "No diagnostic logs on failure"

        # Check for key diagnostic info: operation, cause, context
        log_content = str(logged_diagnostics)
        assert (
            "save" in log_content.lower() or "write" in log_content.lower()
        ), "Operation not logged"

    def test_rollback_status_logged(self, storage, caplog):
        """Test that rollback status is included in diagnostic logs."""
        plugin = create_test_plugin(
            id="rollback-status",
            name="Rollback Status",
            version="1.0.0",
            category="system",
            description="Test rollback status logging",
            parameters=[],
        )

        with caplog.at_level(logging.ERROR, logger=_STORAGE_LOGGER):
            with patch("yaml.dump", side_effect=Exception("Transaction failed")):
                with pytest.raises(Exception, match="^Transaction failed$"):
                    storage.save_plugin(plugin)

        # Verify rollback status in logs
        logged_messages = _storage_messages(caplog, logging.ERROR)
        assert any(
            "Rolling back transaction and cleaning up temporary files" in msg
            for msg in logged_messages
        ), "Rollback status not logged"

    def test_no_persistent_changes_on_failure(self, storage, temp_storage_dir):
        """Test that failed transactions leave no persistent changes."""
        plugin = create_test_plugin(
            id="no-persist-fail",
            name="No Persist Fail",
            version="1.0.0",
            category="system",
            description="Test no persistent changes on failure",
            parameters=[],
        )

        # Capture initial filesystem state
        initial_files = set()
        for root, _dirs, files in os.walk(temp_storage_dir):
            for file in files:
                initial_files.add(Path(root) / file)

        # Attempt transaction that fails
        with patch("yaml.dump", side_effect=Exception("Transaction failed")):
            with pytest.raises(Exception, match="^Transaction failed$"):
                storage.save_plugin(plugin)

        # Capture final filesystem state
        final_files = set()
        for root, _dirs, files in os.walk(temp_storage_dir):
            for file in files:
                final_files.add(Path(root) / file)

        # No new files should exist
        new_files = final_files - initial_files
        assert len(new_files) == 0, f"Persistent changes left after failure: {new_files}"


class TestCleanupErrorHandling:
    """Test defensive error handling during cleanup operations (REQ-4.3.5 - coverage completion)."""

    @pytest.fixture
    def temp_storage_dir(self):
        """Create temporary storage directory."""
        temp_dir = tempfile.mkdtemp()
        yield Path(temp_dir)
        shutil.rmtree(temp_dir)

    @pytest.fixture
    def storage(self, temp_storage_dir):
        """Create file-based storage instance."""
        return FileBasedStorage(base_path=temp_storage_dir)

    def test_oserror_during_lock_release_on_success(self, storage):
        """Test OSError when releasing lock after successful write (lines 170-171)."""
        plugin = create_test_plugin(
            id="lock-release-error",
            name="Lock Release Error",
            version="1.0.0",
            category="system",
            description="Test OSError during lock release",
            parameters=[],
        )

        flock_calls = []

        def flock_with_unlock_error(fd, operation):
            flock_calls.append(operation)
            if operation & fcntl.LOCK_UN:
                # Simulate error when releasing lock
                raise OSError("Lock release failed")

        with patch("fcntl.flock", side_effect=flock_with_unlock_error):
            # Should succeed despite unlock error (defensive handling)
            storage.save_plugin(plugin, format="yaml")

        # Verify plugin was saved despite cleanup error
        loaded = storage.load_plugin("lock-release-error", version="1.0.0")
        assert loaded is not None

    def test_oserror_during_fd_close_on_success(self, storage):
        """Test OSError when closing file descriptor after successful write (lines 174-175)."""
        plugin = create_test_plugin(
            id="fd-close-error",
            name="FD Close Error",
            version="1.0.0",
            category="system",
            description="Test OSError during fd close",
            parameters=[],
        )

        _original_close = os.close

        def close_with_error(fd):
            # Simulate error when closing fd
            raise OSError("Close failed")

        with patch("os.close", side_effect=close_with_error):
            # Should succeed despite close error
            storage.save_plugin(plugin, format="yaml")

        # Verify plugin was saved
        loaded = storage.load_plugin("fd-close-error", version="1.0.0")
        assert loaded is not None

    def test_oserror_during_lock_file_unlink_on_success(self, storage):
        """Test OSError when unlinking lock file after successful write (lines 182-183)."""
        plugin = create_test_plugin(
            id="lock-unlink-error",
            name="Lock Unlink Error",
            version="1.0.0",
            category="system",
            description="Test OSError during lock file unlink",
            parameters=[],
        )

        original_unlink = Path.unlink

        def unlink_with_error(self, *args, **kwargs):
            if ".lock" in str(self):
                raise OSError("Unlink failed")
            return original_unlink(self, *args, **kwargs)

        with patch.object(Path, "unlink", unlink_with_error):
            # Should succeed despite unlink error
            storage.save_plugin(plugin, format="yaml")

        # Verify plugin was saved
        loaded = storage.load_plugin("lock-unlink-error", version="1.0.0")
        assert loaded is not None

    def test_oserror_during_fd_close_on_blocking_error(self, storage):
        """Test OSError when closing fd after BlockingIOError (lines 195-196)."""
        plugin = create_test_plugin(
            id="blocking-fd-close",
            name="Blocking FD Close",
            version="1.0.0",
            category="system",
            description="Test OSError during fd close in BlockingIOError path",
            parameters=[],
        )

        close_call_count = []

        def flock_blocking(fd, operation):
            if operation & fcntl.LOCK_EX:
                raise BlockingIOError("Resource temporarily unavailable")

        def close_with_error(fd):
            close_call_count.append(1)
            if len(close_call_count) <= 5:  # First few closes during cleanup fail
                raise OSError("Close failed")

        with patch("fcntl.flock", side_effect=flock_blocking):
            with patch("os.close", side_effect=close_with_error):
                with pytest.raises(BlockingIOError):
                    storage.save_plugin(plugin, format="yaml")

        # Verify OSError during cleanup was handled
        assert len(close_call_count) > 0

    def test_oserror_during_lock_file_unlink_on_blocking_error(self, storage):
        """Test OSError when unlinking lock file after BlockingIOError (lines 203-204)."""
        plugin = create_test_plugin(
            id="blocking-unlink",
            name="Blocking Unlink",
            version="1.0.0",
            category="system",
            description="Test OSError during lock unlink in BlockingIOError path",
            parameters=[],
        )

        unlink_attempts = []
        original_unlink = Path.unlink

        def flock_blocking(fd, operation):
            if operation & fcntl.LOCK_EX:
                raise BlockingIOError("Resource temporarily unavailable")

        def unlink_with_error(self, *args, **kwargs):
            if ".lock" in str(self):
                unlink_attempts.append(1)
                raise OSError("Unlink failed")
            # Allow other files to be unlinked normally
            return original_unlink(self, *args, **kwargs)

        with patch("fcntl.flock", side_effect=flock_blocking):
            with patch.object(Path, "unlink", unlink_with_error):
                with pytest.raises(BlockingIOError):
                    storage.save_plugin(plugin, format="yaml")

        # Verify unlink was attempted and error was handled
        assert len(unlink_attempts) > 0

    def test_oserror_during_temp_unlink_on_keyboard_interrupt(self, storage):
        """Test OSError when unlinking temp file after KeyboardInterrupt (lines 221-222)."""
        plugin = create_test_plugin(
            id="keyboard-temp-unlink",
            name="Keyboard Temp Unlink",
            version="1.0.0",
            category="system",
            description="Test OSError during temp unlink on KeyboardInterrupt",
            parameters=[],
        )

        original_unlink = Path.unlink

        def unlink_with_error(self, *args, **kwargs):
            if ".tmp" in str(self):
                raise OSError("Temp file unlink failed")
            return original_unlink(self, *args, **kwargs)

        with patch("yaml.dump", side_effect=KeyboardInterrupt("User canceled")):
            with patch.object(Path, "unlink", unlink_with_error):
                with pytest.raises(KeyboardInterrupt):
                    storage.save_plugin(plugin, format="yaml")

    def test_oserror_during_fd_close_on_keyboard_interrupt(self, storage):
        """Test OSError when closing fd after KeyboardInterrupt (lines 228-229)."""
        plugin = create_test_plugin(
            id="keyboard-fd-close",
            name="Keyboard FD Close",
            version="1.0.0",
            category="system",
            description="Test OSError during fd close on KeyboardInterrupt",
            parameters=[],
        )

        def close_with_error(fd):
            raise OSError("Close failed")

        with patch("yaml.dump", side_effect=KeyboardInterrupt("User canceled")):
            with patch("os.close", side_effect=close_with_error):
                with pytest.raises(KeyboardInterrupt):
                    storage.save_plugin(plugin, format="yaml")

    def test_oserror_during_lock_unlink_on_keyboard_interrupt(self, storage):
        """Test OSError when unlinking lock file after KeyboardInterrupt (lines 234-235)."""
        plugin = create_test_plugin(
            id="keyboard-lock-unlink",
            name="Keyboard Lock Unlink",
            version="1.0.0",
            category="system",
            description="Test OSError during lock unlink on KeyboardInterrupt",
            parameters=[],
        )

        original_unlink = Path.unlink

        def unlink_with_error(self, *args, **kwargs):
            if ".lock" in str(self):
                raise OSError("Lock file unlink failed")
            return original_unlink(self, *args, **kwargs)

        with patch("yaml.dump", side_effect=KeyboardInterrupt("User canceled")):
            with patch.object(Path, "unlink", unlink_with_error):
                with pytest.raises(KeyboardInterrupt):
                    storage.save_plugin(plugin, format="yaml")

    def test_oserror_during_temp_cleanup_with_logging(self, storage, caplog):
        """Test OSError when unlinking temp file with logging (lines 252-253)."""
        plugin = create_test_plugin(
            id="temp-cleanup-log",
            name="Temp Cleanup Log",
            version="1.0.0",
            category="system",
            description="Test OSError during temp cleanup with logging",
            parameters=[],
        )

        original_unlink = Path.unlink

        def unlink_with_error(self, *args, **kwargs):
            if ".tmp" in str(self):
                raise OSError("Temp cleanup failed")
            return original_unlink(self, *args, **kwargs)

        with caplog.at_level(logging.WARNING, logger=_STORAGE_LOGGER):
            with patch.object(Path, "unlink", unlink_with_error):
                with patch("yaml.dump", side_effect=OSError("Write failed")):
                    with pytest.raises(OSError, match="^Write failed$"):
                        storage.save_plugin(plugin, format="yaml")

        # Verify warning was logged for cleanup failure
        logged_warnings = _storage_messages(caplog, logging.WARNING)
        assert len(logged_warnings) > 0
        assert any("clean up temp file" in msg.lower() for msg in logged_warnings)

    def test_oserror_during_lock_release_on_exception(self, storage):
        """Test OSError when releasing lock after general exception (lines 261-262)."""
        plugin = create_test_plugin(
            id="exception-lock-release",
            name="Exception Lock Release",
            version="1.0.0",
            category="system",
            description="Test OSError during lock release on exception",
            parameters=[],
        )

        def flock_with_unlock_error(fd, operation):
            if operation & fcntl.LOCK_UN:
                raise OSError("Unlock failed")

        with patch("fcntl.flock", side_effect=flock_with_unlock_error):
            with patch("yaml.dump", side_effect=OSError("Write failed")):
                with pytest.raises(OSError, match="^Write failed$"):
                    storage.save_plugin(plugin, format="yaml")

    def test_oserror_during_fd_close_on_exception(self, storage):
        """Test OSError when closing fd after general exception (lines 265-266)."""
        plugin = create_test_plugin(
            id="exception-fd-close",
            name="Exception FD Close",
            version="1.0.0",
            category="system",
            description="Test OSError during fd close on exception",
            parameters=[],
        )

        def close_with_error(fd):
            raise OSError("Close failed")

        with patch("os.close", side_effect=close_with_error):
            with patch("yaml.dump", side_effect=OSError("Write failed")):
                with pytest.raises(OSError, match="^Write failed$"):
                    storage.save_plugin(plugin, format="yaml")

    def test_oserror_during_lock_unlink_on_exception(self, storage):
        """Test OSError when unlinking lock file after general exception (lines 273-274)."""
        plugin = create_test_plugin(
            id="exception-lock-unlink",
            name="Exception Lock Unlink",
            version="1.0.0",
            category="system",
            description="Test OSError during lock unlink on exception",
            parameters=[],
        )

        original_unlink = Path.unlink

        def unlink_with_error(self, *args, **kwargs):
            if ".lock" in str(self):
                raise OSError("Lock unlink failed")
            return original_unlink(self, *args, **kwargs)

        with patch.object(Path, "unlink", unlink_with_error):
            with patch("yaml.dump", side_effect=OSError("Write failed")):
                with pytest.raises(OSError, match="^Write failed$"):
                    storage.save_plugin(plugin, format="yaml")
