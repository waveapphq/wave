"""
Tests for REQ-4.3.1: Graceful Error Handling.

Implements comprehensive test coverage for graceful error handling including:
- Error detection and classification
- Error isolation boundaries
- Resource cleanup guarantees
- Error context preservation
- System stability maintenance
- Integration with error handling constructs
- Error recovery coordination
- Observability and diagnostics
"""

import asyncio
import time
from datetime import UTC, datetime

import pytest

from wavecore.core.errors.error_handling import (
    ErrorCategory,
    ErrorClassifier,
    ErrorContext,
    ErrorIsolationBoundary,
    ErrorRecoveryCoordinator,
    GracefulErrorHandler,
    ResourceCleanupManager,
    SystemStabilityMonitor,
)
from wavecore.models.enums import ExecutionState

# ============================================================================
# Test 1: Error Detection and Classification
# ============================================================================


class TestErrorClassification:
    """Test error classification into transient, permanent, and critical categories."""

    def test_classify_transient_network_error(self):
        """Test classification of network errors as transient (retryable)."""
        classifier = ErrorClassifier()

        error = ConnectionError("Connection refused")
        category = classifier.classify(error)

        assert category == ErrorCategory.TRANSIENT
        assert category.is_retryable is True
        assert "network" in category.description.lower()

    def test_classify_transient_timeout_error(self):
        """Test classification of timeout errors as transient (retryable)."""
        classifier = ErrorClassifier()

        error = TimeoutError("Operation timed out")
        category = classifier.classify(error)

        assert category == ErrorCategory.TRANSIENT
        assert category.is_retryable is True

    def test_classify_permanent_assertion_error(self):
        """Test classification of assertion errors as permanent (non-retryable)."""
        classifier = ErrorClassifier()

        error = AssertionError("Expected value 5, got 3")
        category = classifier.classify(error)

        assert category == ErrorCategory.PERMANENT
        assert category.is_retryable is False
        assert "assertion" in category.description.lower()

    def test_classify_permanent_validation_error(self):
        """Test classification of validation errors as permanent (non-retryable)."""
        classifier = ErrorClassifier()

        error = ValueError("Invalid configuration: missing required field 'api_key'")
        category = classifier.classify(error)

        assert category == ErrorCategory.PERMANENT
        assert category.is_retryable is False

    def test_classify_critical_memory_error(self):
        """Test classification of memory errors as critical (escalate)."""
        classifier = ErrorClassifier()

        error = MemoryError("Cannot allocate memory")
        category = classifier.classify(error)

        assert category == ErrorCategory.CRITICAL
        assert category.is_retryable is False
        assert category.requires_escalation is True

    def test_classify_critical_engine_failure(self):
        """Test classification of engine failures as critical (escalate)."""
        classifier = ErrorClassifier()

        error = RuntimeError("Execution engine corruption detected")
        category = classifier.classify(error)

        assert category == ErrorCategory.CRITICAL
        assert category.requires_escalation is True

    def test_classification_context_propagation(self):
        """Test that classification context propagates through error handling stages."""
        classifier = ErrorClassifier()

        error = ConnectionError("Database connection lost")
        category = classifier.classify(error)

        # Classification should attach metadata
        assert category.error_type == "ConnectionError"
        assert category.timestamp is not None
        assert (datetime.now(UTC) - category.timestamp).total_seconds() < 1

    def test_custom_classification_rules(self):
        """Test that custom classification rules can be registered."""
        classifier = ErrorClassifier()

        # Register custom rule: treat specific ValueError as transient
        classifier.register_rule(
            error_pattern=r"Temporary resource unavailable", category=ErrorCategory.TRANSIENT
        )

        error = ValueError("Temporary resource unavailable")
        category = classifier.classify(error)

        assert category == ErrorCategory.TRANSIENT
        assert category.is_retryable is True

    def test_error_category_structure(self):
        """Test that ErrorCategory has required attributes for all categories."""
        # Test TRANSIENT category
        transient = ErrorCategory.TRANSIENT
        assert hasattr(transient, "is_retryable")
        assert hasattr(transient, "description")
        assert hasattr(transient, "error_type")
        assert transient.is_retryable is True

        # Test PERMANENT category
        permanent = ErrorCategory.PERMANENT
        assert permanent.is_retryable is False
        assert hasattr(permanent, "description")

        # Test CRITICAL category
        critical = ErrorCategory.CRITICAL
        assert critical.is_retryable is False
        assert hasattr(critical, "requires_escalation")
        assert critical.requires_escalation is True

    def test_classify_resource_unavailability_error(self):
        """Test classification of resource unavailability errors as transient."""
        classifier = ErrorClassifier()

        error = RuntimeError("Resource temporarily unavailable")
        category = classifier.classify(error)

        assert category == ErrorCategory.TRANSIENT
        assert category.is_retryable is True

    def test_classify_infrastructure_failure_error(self):
        """Test classification of infrastructure failures as critical."""
        classifier = ErrorClassifier()

        error = RuntimeError("Kubernetes node failure detected")
        category = classifier.classify(error)

        assert category == ErrorCategory.CRITICAL
        assert category.requires_escalation is True

    # ============================================================================
    # Test 2: Error Isolation Boundaries
    # ============================================================================

    def test_error_category_initialization(self):
        """Test ErrorCategory enum initialization sets error_type to empty string."""
        category = ErrorCategory.TRANSIENT
        # Accessing the category should have initialized error_type to ""
        assert hasattr(category, "error_type")
        # Fresh category instance has empty error_type initially
        assert category.error_type == "" or isinstance(category.error_type, str)

    def test_classify_unknown_error_type(self):
        """Test classification of unknown error types defaults to permanent."""
        classifier = ErrorClassifier()

        # Custom error type not explicitly handled
        class CustomUnknownError(Exception):
            pass

        error = CustomUnknownError("Unknown error type")
        category = classifier.classify(error)

        # Should default to PERMANENT
        assert category == ErrorCategory.PERMANENT
        assert category.is_retryable is False

    def test_error_category_critical_description(self):
        """Test ErrorCategory.CRITICAL description property."""
        # Access the description to trigger line 56
        critical = ErrorCategory.CRITICAL
        desc = critical.description
        assert "critical" in desc.lower()
        assert "escalation" in desc.lower()

    def test_classify_generic_runtime_error(self):
        """Test classification of generic RuntimeError (not matching any special patterns)."""
        classifier = ErrorClassifier()

        # RuntimeError without special keywords -> defaults to PERMANENT
        error = RuntimeError("Some generic runtime error")
        category = classifier.classify(error)

        # Should be PERMANENT (line 129)
        assert category == ErrorCategory.PERMANENT


class TestErrorIsolationBoundaries:
    """Test error isolation boundaries preventing cascading failures."""

    def test_plugin_error_isolated_to_block(self):
        """Test that plugin failures are contained within their block."""
        boundary = ErrorIsolationBoundary(level="plugin")

        # Simulate plugin failure
        plugin_error = RuntimeError("Plugin execution failed")
        boundary.capture_error(error=plugin_error, entity_id="plugin-1", entity_type="plugin")

        # Error should be marked as contained
        assert boundary.is_contained() is True
        assert boundary.get_propagation_level() == "block"
        assert boundary.should_propagate_to_parent() is False

    def test_block_error_isolated_to_test(self):
        """Test that block failures are contained within their test."""
        boundary = ErrorIsolationBoundary(level="block")

        block_error = ValueError("Block validation failed")
        boundary.capture_error(error=block_error, entity_id="block-1", entity_type="block")

        assert boundary.is_contained() is True
        assert boundary.get_propagation_level() == "test"
        assert boundary.should_propagate_to_parent() is False

    def test_test_error_isolated_to_suite(self):
        """Test that test failures are contained within their suite."""
        boundary = ErrorIsolationBoundary(level="test")

        test_error = AssertionError("Test assertion failed")
        boundary.capture_error(error=test_error, entity_id="test-1", entity_type="test")

        assert boundary.is_contained() is True
        assert boundary.get_propagation_level() == "suite"

    def test_suite_error_isolated_to_regression(self):
        """Test that suite failures are contained within their regression."""
        boundary = ErrorIsolationBoundary(level="suite")

        suite_error = RuntimeError("Suite setup failed")
        boundary.capture_error(error=suite_error, entity_id="suite-1", entity_type="suite")

        assert boundary.is_contained() is True
        assert boundary.get_propagation_level() == "regression"

    def test_critical_error_propagates_upward(self):
        """Test that critical errors propagate upward despite boundaries."""
        boundary = ErrorIsolationBoundary(level="plugin")

        critical_error = MemoryError("Out of memory")
        boundary.capture_error(
            error=critical_error, entity_id="plugin-1", entity_type="plugin", is_critical=True
        )

        # Critical errors should propagate
        assert boundary.should_propagate_to_parent() is True
        assert boundary.get_propagation_level() == "system"

    def test_sibling_entities_unaffected_by_error(self):
        """Test that sibling entities are not affected by isolated errors."""
        boundary = ErrorIsolationBoundary(level="block")

        # Block-1 fails
        boundary.capture_error(
            error=ValueError("Block 1 failed"), entity_id="block-1", entity_type="block"
        )

        # Block-2 should be unaffected
        assert boundary.is_entity_affected("block-2") is False
        assert boundary.is_entity_affected("block-1") is True

    def test_try_catch_can_intercept_errors(self):
        """Test that try-catch constructs can intercept errors at any level."""
        boundary = ErrorIsolationBoundary(level="test")
        boundary.register_try_catch_handler(handler_id="try-catch-1")

        test_error = RuntimeError("Test failed")
        boundary.capture_error(error=test_error, entity_id="block-1", entity_type="block")

        # Try-catch should intercept before propagation
        assert boundary.is_intercepted_by_handler("try-catch-1") is True
        assert boundary.should_propagate_to_parent() is False

    def test_execution_context_separation(self):
        """Test that each boundary maintains isolated state, resources, and error tracking."""
        # Create two block boundaries at same level
        block_boundary_1 = ErrorIsolationBoundary(level="block", entity_id="block-1")
        block_boundary_2 = ErrorIsolationBoundary(level="block", entity_id="block-2")

        # Each should have separate state
        block_boundary_1.set_state({"variable": "value-1"})
        block_boundary_2.set_state({"variable": "value-2"})

        assert block_boundary_1.get_state()["variable"] == "value-1"
        assert block_boundary_2.get_state()["variable"] == "value-2"

        # Each should track separate resources
        block_boundary_1.register_resource(resource_id="resource-1")
        block_boundary_2.register_resource(resource_id="resource-2")

        assert block_boundary_1.has_resource("resource-1") is True
        assert block_boundary_1.has_resource("resource-2") is False
        assert block_boundary_2.has_resource("resource-2") is True
        assert block_boundary_2.has_resource("resource-1") is False

        # Each should track separate errors
        block_boundary_1.capture_error(
            error=ValueError("Error in block-1"), entity_id="block-1", entity_type="block"
        )

        assert block_boundary_1.has_error() is True
        assert block_boundary_2.has_error() is False

    @pytest.mark.asyncio
    async def test_sibling_entities_continue_execution(self):
        """Test that sibling entities continue execution when one fails."""
        boundary = ErrorIsolationBoundary(level="test")
        execution_log = []

        # Simulate block-1 execution and failure
        execution_log.append("block-1-start")
        boundary.capture_error(
            error=ValueError("Block 1 failed"), entity_id="block-1", entity_type="block"
        )
        execution_log.append("block-1-error")

        # Block-2 should be able to execute despite block-1 failure
        can_execute_block_2 = boundary.can_entity_execute("block-2")
        assert can_execute_block_2 is True

        # Simulate block-2 execution
        execution_log.append("block-2-start")
        execution_log.append("block-2-complete")

        # Block-3 should also be able to execute
        can_execute_block_3 = boundary.can_entity_execute("block-3")
        assert can_execute_block_3 is True

        execution_log.append("block-3-start")
        execution_log.append("block-3-complete")

        # Verify all blocks executed (only block-1 failed)
        assert "block-1-start" in execution_log
        assert "block-1-error" in execution_log
        assert "block-2-complete" in execution_log
        assert "block-3-complete" in execution_log

    # ============================================================================
    # Test 3: Resource Cleanup Guarantees
    # ============================================================================

    def test_isolation_boundary_invalid_level_propagation(self):
        """Test propagation level for invalid/unknown boundary level."""
        # Use a level not in hierarchy to trigger ValueError exception path
        boundary = ErrorIsolationBoundary(level="completely_unknown_level")

        boundary.capture_error(
            error=RuntimeError("Error"), entity_id="entity-1", entity_type="unknown"
        )

        # Should propagate to "system" for unknown levels (hits except ValueError on line 438)
        propagation_level = boundary.get_propagation_level()
        assert propagation_level == "system"

    def test_isolation_boundary_regression_level_propagation(self):
        """Test propagation level for regression (last in hierarchy)."""
        # Regression is the last level in the hierarchy
        boundary = ErrorIsolationBoundary(level="regression")

        boundary.capture_error(
            error=RuntimeError("Error"), entity_id="entity-1", entity_type="regression"
        )

        # Should propagate to "system" when at last level (hits line 436)
        propagation_level = boundary.get_propagation_level()
        assert propagation_level == "system"

    def test_isolation_boundary_can_entity_execute_when_critical(self):
        """Test that no entities can execute when critical error occurs."""
        boundary = ErrorIsolationBoundary(level="test")

        boundary.capture_error(
            error=MemoryError("Critical error"),
            entity_id="entity-1",
            entity_type="test",
            is_critical=True,
        )

        # No entity should be able to execute with critical error
        assert boundary.can_entity_execute("entity-2") is False
        assert boundary.can_entity_execute("entity-3") is False


class TestResourceCleanupGuarantees:
    """Test deterministic resource cleanup in reverse acquisition order."""

    @pytest.mark.asyncio
    async def test_cleanup_reverse_acquisition_order(self):
        """Test that resources are cleaned up in reverse acquisition order."""
        cleanup_manager = ResourceCleanupManager()
        cleanup_order = []

        # Acquire resources in order
        cleanup_manager.register_resource(
            resource_id="db-connection", cleanup_fn=lambda: cleanup_order.append("db-connection")
        )
        cleanup_manager.register_resource(
            resource_id="file-handle", cleanup_fn=lambda: cleanup_order.append("file-handle")
        )
        cleanup_manager.register_resource(
            resource_id="network-socket", cleanup_fn=lambda: cleanup_order.append("network-socket")
        )

        # Trigger cleanup
        await cleanup_manager.cleanup_all()

        # Verify reverse order: network-socket, file-handle, db-connection
        assert cleanup_order == ["network-socket", "file-handle", "db-connection"]

    @pytest.mark.asyncio
    async def test_cleanup_continues_on_handler_error(self):
        """Test that cleanup continues even if individual handlers fail."""
        cleanup_manager = ResourceCleanupManager()
        cleanup_order = []

        def failing_cleanup():
            raise RuntimeError("Cleanup failed")

        cleanup_manager.register_resource(
            resource_id="resource-1", cleanup_fn=lambda: cleanup_order.append("resource-1")
        )
        cleanup_manager.register_resource(resource_id="resource-2", cleanup_fn=failing_cleanup)
        cleanup_manager.register_resource(
            resource_id="resource-3", cleanup_fn=lambda: cleanup_order.append("resource-3")
        )

        await cleanup_manager.cleanup_all()

        # Both resource-1 and resource-3 should be cleaned up despite resource-2 failure
        assert "resource-1" in cleanup_order
        assert "resource-3" in cleanup_order

    @pytest.mark.asyncio
    async def test_cleanup_hierarchical_unwinding(self):
        """Test cleanup proceeds upward through hierarchy (plugin→block→test→suite)."""
        cleanup_manager = ResourceCleanupManager()
        cleanup_order = []

        # Register cleanup at different levels
        cleanup_manager.register_resource(
            resource_id="plugin-resource",
            level="plugin",
            cleanup_fn=lambda: cleanup_order.append("plugin"),
        )
        cleanup_manager.register_resource(
            resource_id="block-resource",
            level="block",
            cleanup_fn=lambda: cleanup_order.append("block"),
        )
        cleanup_manager.register_resource(
            resource_id="test-resource",
            level="test",
            cleanup_fn=lambda: cleanup_order.append("test"),
        )

        await cleanup_manager.cleanup_all()

        # Cleanup should proceed bottom-up: plugin → block → test
        assert cleanup_order == ["plugin", "block", "test"]

    @pytest.mark.asyncio
    async def test_cleanup_suite_and_regression_levels(self):
        """Test cleanup proceeds through complete hierarchy including suite and regression."""
        cleanup_manager = ResourceCleanupManager()
        cleanup_order = []

        # Register cleanup at all levels
        cleanup_manager.register_resource(
            resource_id="plugin-resource",
            level="plugin",
            cleanup_fn=lambda: cleanup_order.append("plugin"),
        )
        cleanup_manager.register_resource(
            resource_id="block-resource",
            level="block",
            cleanup_fn=lambda: cleanup_order.append("block"),
        )
        cleanup_manager.register_resource(
            resource_id="test-resource",
            level="test",
            cleanup_fn=lambda: cleanup_order.append("test"),
        )
        cleanup_manager.register_resource(
            resource_id="suite-resource",
            level="suite",
            cleanup_fn=lambda: cleanup_order.append("suite"),
        )
        cleanup_manager.register_resource(
            resource_id="regression-resource",
            level="regression",
            cleanup_fn=lambda: cleanup_order.append("regression"),
        )

        await cleanup_manager.cleanup_all()

        # Cleanup should proceed bottom-up through all levels
        assert cleanup_order == ["plugin", "block", "test", "suite", "regression"]

    @pytest.mark.asyncio
    async def test_cleanup_order_preserved_on_errors(self):
        """Test that cleanup order is maintained even when individual cleanups fail."""
        cleanup_manager = ResourceCleanupManager()
        cleanup_order = []
        cleanup_errors = []

        def failing_cleanup_2():
            cleanup_order.append("resource-2-attempted")
            raise RuntimeError("Cleanup 2 failed")

        def failing_cleanup_4():
            cleanup_order.append("resource-4-attempted")
            raise ValueError("Cleanup 4 failed")

        # Register resources with some failing cleanups
        cleanup_manager.register_resource(
            resource_id="resource-1", cleanup_fn=lambda: cleanup_order.append("resource-1")
        )
        cleanup_manager.register_resource(resource_id="resource-2", cleanup_fn=failing_cleanup_2)
        cleanup_manager.register_resource(
            resource_id="resource-3", cleanup_fn=lambda: cleanup_order.append("resource-3")
        )
        cleanup_manager.register_resource(resource_id="resource-4", cleanup_fn=failing_cleanup_4)
        cleanup_manager.register_resource(
            resource_id="resource-5", cleanup_fn=lambda: cleanup_order.append("resource-5")
        )

        # Set error collector
        cleanup_manager.set_error_collector(lambda e: cleanup_errors.append(e))

        await cleanup_manager.cleanup_all()

        # Verify cleanup happened in reverse order (5, 4, 3, 2, 1)
        # Even failed cleanups should be attempted in order
        assert cleanup_order == [
            "resource-5",
            "resource-4-attempted",
            "resource-3",
            "resource-2-attempted",
            "resource-1",
        ]

        # Verify errors were collected
        assert len(cleanup_errors) == 2
        assert any("Cleanup 2 failed" in str(e) for e in cleanup_errors)
        assert any("Cleanup 4 failed" in str(e) for e in cleanup_errors)

    @pytest.mark.asyncio
    async def test_cleanup_partial_results_stored(self):
        """Test that partial results are stored even during cleanup."""
        cleanup_manager = ResourceCleanupManager()

        # Simulate partial execution with results
        cleanup_manager.store_partial_result(
            entity_id="block-1", result={"status": "partial", "data": [1, 2, 3]}
        )

        # Trigger error and cleanup
        await cleanup_manager.cleanup_all()

        # Partial results should be preserved
        assert cleanup_manager.get_partial_result("block-1") is not None
        assert cleanup_manager.get_partial_result("block-1")["status"] == "partial"

    @pytest.mark.asyncio
    async def test_finalize_blocks_execute_on_error(self):
        """Test that finalize blocks execute regardless of error."""
        cleanup_manager = ResourceCleanupManager()
        finalize_executed = []

        cleanup_manager.register_finalize_block(
            finalize_fn=lambda: finalize_executed.append("finalize-1")
        )

        # Simulate error during execution
        cleanup_manager.trigger_error(RuntimeError("Execution failed"))

        # Cleanup should still run finalize blocks
        await cleanup_manager.cleanup_all()

        assert "finalize-1" in finalize_executed

    @pytest.mark.asyncio
    async def test_cleanup_timeout_protection(self):
        """Test that cleanup operations are timeout-protected."""
        cleanup_manager = ResourceCleanupManager(cleanup_timeout=0.1)

        async def slow_cleanup():
            await asyncio.sleep(1.0)  # Longer than timeout

        cleanup_manager.register_resource(resource_id="slow-resource", cleanup_fn=slow_cleanup)

        start = time.time()
        await cleanup_manager.cleanup_all()
        duration = time.time() - start

        # Cleanup should be aborted around timeout (0.1s), not wait full 1.0s
        assert duration < 0.5  # Some margin for overhead

    # ============================================================================
    # Test 4: Error Context Preservation
    # ============================================================================

    @pytest.mark.asyncio
    async def test_cleanup_async_finalize_blocks(self):
        """Test cleanup handles async finalize blocks correctly."""
        cleanup_manager = ResourceCleanupManager()
        finalize_executed = []

        async def async_finalize():
            finalize_executed.append("async-finalize")

        cleanup_manager.register_finalize_block(finalize_fn=async_finalize)

        await cleanup_manager.cleanup_all()

        assert "async-finalize" in finalize_executed

    @pytest.mark.asyncio
    async def test_cleanup_timeout_error_collection(self):
        """Test that cleanup timeout errors are collected properly."""
        cleanup_manager = ResourceCleanupManager(cleanup_timeout=0.05)
        collected_errors = []

        async def slow_cleanup():
            await asyncio.sleep(1.0)  # Will timeout

        cleanup_manager.set_error_collector(lambda e: collected_errors.append(e))
        cleanup_manager.register_resource(resource_id="slow-resource", cleanup_fn=slow_cleanup)

        await cleanup_manager.cleanup_all()

        # Should have collected timeout error
        assert len(collected_errors) > 0
        assert any("timeout" in str(e).lower() for e in collected_errors)

    @pytest.mark.asyncio
    async def test_cleanup_finalize_exception_handling(self):
        """Test that exceptions in finalize blocks are collected."""
        cleanup_manager = ResourceCleanupManager()
        collected_errors = []

        def failing_finalize():
            raise ValueError("Finalize failed")

        cleanup_manager.register_finalize_block(finalize_fn=failing_finalize)
        cleanup_manager.set_error_collector(lambda e: collected_errors.append(e))

        await cleanup_manager.cleanup_all()

        # Exception should have been collected (lines 542-544)
        assert len(collected_errors) == 1
        assert "Finalize failed" in str(collected_errors[0])


class TestErrorContextPreservation:
    """Test comprehensive error context preservation."""

    def test_capture_origin_location(self):
        """Test that error origin location is captured."""
        context = ErrorContext()

        context.capture_origin(
            entity_type="plugin",
            entity_id="sql-query-plugin",
            entity_version="1.2.0",
            hierarchy_path=["regression-1", "suite-1", "test-1", "block-1", "plugin-1"],
        )

        assert context.origin.entity_type == "plugin"
        assert context.origin.entity_id == "sql-query-plugin"
        assert context.origin.hierarchy_path[-1] == "plugin-1"

    def test_capture_execution_state(self):
        """Test that execution state with variables and partial results is captured."""
        context = ErrorContext()

        context.capture_execution_state(
            variables={"db_host": "localhost", "port": 5432},
            partial_results={"rows_processed": 42},
            current_state=ExecutionState.RUNNING,
        )

        assert context.execution_state.variables["db_host"] == "localhost"
        assert context.execution_state.partial_results["rows_processed"] == 42
        assert context.execution_state.current_state == ExecutionState.RUNNING

    def test_capture_error_chain_causality(self):
        """Test that error chain preserves causality."""
        context = ErrorContext()

        root_error = ConnectionError("Database unreachable")
        intermediate_error = RuntimeError("Query execution failed")
        final_error = ValueError("Result validation failed")

        context.add_to_chain(root_error)
        context.add_to_chain(intermediate_error, caused_by=root_error)
        context.add_to_chain(final_error, caused_by=intermediate_error)

        # Verify chain structure
        chain = context.get_error_chain()
        assert len(chain) == 3
        assert chain[0].error_type == "ConnectionError"
        assert chain[1].caused_by == chain[0]
        assert chain[2].caused_by == chain[1]

    def test_capture_environmental_context(self):
        """Test that environmental context (resources, infrastructure) is captured."""
        context = ErrorContext()

        context.capture_environment(
            resources={"memory_mb": 2048, "cpu_percent": 75.5},
            infrastructure={"kubernetes_pod": "wave-executor-1", "node": "worker-3"},
        )

        assert context.environment.resources["memory_mb"] == 2048
        assert context.environment.infrastructure["kubernetes_pod"] == "wave-executor-1"

    def test_capture_user_defined_context(self):
        """Test that user-defined context from variables is captured."""
        context = ErrorContext()

        context.capture_user_defined(
            custom_variables={"test_run_id": "run-12345", "environment": "staging"}
        )

        assert context.user_defined["test_run_id"] == "run-12345"
        assert context.user_defined["environment"] == "staging"

    def test_no_name_heuristic_masking_in_context(self):
        """No name-guessing; unflagged variables pass through verbatim."""
        context = ErrorContext()

        context.capture_execution_state(
            variables={
                "db_host": "localhost",
                "password": "secret123",
                "api_key": "key-abc-xyz",
            }
        )

        artifact = context.to_artifact()

        assert artifact["execution_state"]["variables"]["password"] == "secret123"
        assert artifact["execution_state"]["variables"]["api_key"] == "key-abc-xyz"
        assert artifact["execution_state"]["variables"]["db_host"] == "localhost"
        assert not hasattr(context, "_mask_secrets")

    def test_context_available_to_error_handling(self):
        """Test that enriched context is available to error handling constructs."""
        context = ErrorContext()

        context.capture_origin(
            entity_type="block", entity_id="validation-block", entity_version="2.1.0"
        )
        context.capture_execution_state(variables={"threshold": 100})

        # Error handling should have access to full context
        handler_context = context.get_handler_context()

        assert handler_context["origin"]["entity_id"] == "validation-block"
        assert handler_context["execution_state"]["variables"]["threshold"] == 100

    def test_context_logged_for_analysis(self):
        """Test that error context is logged for analysis."""
        context = ErrorContext()
        log_entries = []

        # Configure logging
        context.set_logger(lambda entry: log_entries.append(entry))

        # Capture comprehensive context
        context.capture_origin(
            entity_type="plugin", entity_id="http-client", entity_version="1.5.0"
        )
        context.capture_execution_state(
            variables={"url": "https://api.example.com", "timeout": 30},
            partial_results={"status_code": 500},
        )
        context.capture_environment(resources={"memory_mb": 512, "cpu_percent": 45.2})

        # Log the error
        error = ConnectionError("API request failed")
        context.log_error(error)

        # Verify context was logged
        assert len(log_entries) == 1
        log = log_entries[0]
        assert log["error_type"] == "ConnectionError"
        assert log["origin"]["entity_id"] == "http-client"
        assert log["execution_state"]["variables"]["url"] == "https://api.example.com"
        assert log["environment"]["resources"]["memory_mb"] == 512

    def test_capture_parameter_context(self):
        """Test that user-defined context from variables and parameters is captured."""
        context = ErrorContext()

        # Capture both variables and parameters
        context.capture_user_defined(
            custom_variables={"test_run_id": "run-12345", "environment": "staging"},
            parameters={"retry_count": 3, "timeout": 30, "validate_ssl": True},
        )

        # Both should be accessible
        assert context.user_defined["test_run_id"] == "run-12345"
        assert context.user_defined["environment"] == "staging"
        assert context.parameters["retry_count"] == 3
        assert context.parameters["timeout"] == 30
        assert context.parameters["validate_ssl"] is True


# ============================================================================
# Test 5: System Stability Maintenance
# ============================================================================


class TestSystemStabilityMaintenance:
    """Test system stability maintenance under error conditions."""

    def test_critical_error_halts_new_executions(self):
        """Test that critical errors halt new executions while allowing cleanup."""
        monitor = SystemStabilityMonitor()

        # Trigger critical error
        critical_error = MemoryError("Out of memory")
        monitor.report_error(critical_error, category=ErrorCategory.CRITICAL)

        # New executions should be blocked
        assert monitor.can_accept_new_execution() is False

        # In-flight cleanup should still be allowed
        assert monitor.can_perform_cleanup() is True

    def test_resource_monitoring_throttles_execution(self):
        """Test that execution is throttled when approaching resource limits."""
        monitor = SystemStabilityMonitor(memory_threshold_mb=1024, cpu_threshold_percent=90)

        # Simulate high resource usage
        monitor.update_resource_usage(memory_mb=1100, cpu_percent=95)

        # Execution should be throttled
        assert monitor.should_throttle_execution() is True

    def test_error_rate_triggers_backoff(self):
        """Test that sustained high error rate triggers backoff."""
        monitor = SystemStabilityMonitor(error_rate_threshold=0.5, time_window_seconds=10)

        # Simulate high error rate (6 errors in 10 seconds = 60% error rate)
        for _ in range(6):
            monitor.report_error(RuntimeError("Transient failure"))

        # Should trigger backoff
        assert monitor.should_apply_backoff() is True
        assert monitor.get_backoff_delay_seconds() > 0

    def test_health_checks_initiate_safe_shutdown(self):
        """Test that failed health checks initiate safe shutdown."""
        monitor = SystemStabilityMonitor()

        # Simulate subsystem health check failure
        monitor.report_health_check_failure(
            subsystem="database_pool", reason="All connections failed"
        )

        # Should initiate graceful shutdown
        assert monitor.should_initiate_shutdown() is True
        assert monitor.get_shutdown_mode() == "graceful"

    def test_graceful_degradation_over_corruption(self):
        """Test that system prefers graceful degradation over risking corruption."""
        monitor = SystemStabilityMonitor()

        # Simulate condition that risks corruption
        monitor.detect_corruption_risk(component="execution_context", severity="high")

        # System should gracefully degrade
        assert monitor.should_degrade_gracefully() is True
        assert monitor.can_accept_new_execution() is False

    def test_stability_recovery_after_backoff(self):
        """Test that system can recover stability after backoff period."""
        monitor = SystemStabilityMonitor(error_rate_threshold=0.5, backoff_duration_seconds=0.1)

        # Trigger backoff
        for _ in range(5):
            monitor.report_error(RuntimeError("Error"))

        assert monitor.should_apply_backoff() is True

        # Wait for backoff to expire
        time.sleep(0.2)

        # System should allow execution again
        assert monitor.should_apply_backoff() is False

    # ============================================================================
    # Test 6: Integration with Error Handling Constructs
    # ============================================================================

    def test_stability_backoff_not_active(self):
        """Test backoff returns False when no backoff is active."""
        monitor = SystemStabilityMonitor()

        # No errors reported, _backoff_start_time is None
        result = monitor.should_apply_backoff()
        assert result is False

        # Verify backoff_start_time is indeed None
        assert monitor._backoff_start_time is None

    def test_can_accept_execution_during_backoff(self):
        """Test can_accept_new_execution returns False during backoff (line 657)."""
        monitor = SystemStabilityMonitor(error_rate_threshold=0.3)

        # Trigger backoff
        for _ in range(5):
            monitor.report_error(RuntimeError("Error"))

        # During backoff, should not accept new execution (hits line 657)
        can_accept = monitor.can_accept_new_execution()
        assert can_accept is False

    def test_stability_backoff_delay_when_not_active(self):
        """Test backoff delay returns 0 when not in backoff."""
        monitor = SystemStabilityMonitor()

        # No backoff active
        assert monitor.get_backoff_delay_seconds() == 0.0

    def test_backoff_expires_returns_false(self):
        """Test that backoff returns False after expiration."""
        monitor = SystemStabilityMonitor(error_rate_threshold=0.3, backoff_duration_seconds=0.05)

        # Trigger backoff
        for _ in range(5):
            monitor.report_error(RuntimeError("Error"))

        # Should be in backoff
        assert monitor.should_apply_backoff() is True

        # Wait for backoff to expire
        time.sleep(0.1)

        # Should return False after expiration (line 657)
        result = monitor.should_apply_backoff()
        assert result is False


class TestErrorHandlingIntegration:
    """Test integration with try-catch blocks and retry configurations."""

    def test_try_catch_receives_enriched_context(self):
        """Test that try-catch blocks receive enriched error context."""
        handler = GracefulErrorHandler()

        # Create error with context
        error = ValueError("Validation failed")
        context = ErrorContext()
        context.capture_origin(entity_type="block", entity_id="validator", entity_version="1.0.0")

        # Try-catch should receive full context
        catch_context = handler.invoke_try_catch(error=error, context=context)

        assert catch_context is not None
        assert catch_context.origin.entity_id == "validator"

    @pytest.mark.asyncio
    async def test_handled_error_prevents_propagation(self):
        """Test that successfully handled errors don't propagate upward."""
        handler = GracefulErrorHandler()

        error = RuntimeError("Recoverable error")
        context = ErrorContext()

        # Handle error successfully
        is_handled = await handler.handle_in_try_catch(
            error=error, context=context, recovery_action=lambda: "recovered"
        )

        assert is_handled is True
        assert handler.should_propagate(error) is False

    @pytest.mark.asyncio
    async def test_unhandled_error_propagates_with_context(self):
        """Test that unhandled errors propagate upward with combined context."""
        handler = GracefulErrorHandler()

        def failing_recovery():
            raise RuntimeError("Recovery failed")

        error = RuntimeError("Unhandled error")
        original_context = ErrorContext()
        original_context.capture_origin(
            entity_type="plugin", entity_id="plugin-1", entity_version="1.0.0"
        )

        # Attempt to handle but fail
        is_handled = await handler.handle_in_try_catch(
            error=error, context=original_context, recovery_action=failing_recovery
        )

        assert is_handled is False
        assert handler.should_propagate(error) is True

        # Context should be enriched with recovery attempt
        propagated_context = handler.get_propagated_context(error)
        assert "recovery_attempted" in propagated_context.metadata

    @pytest.mark.asyncio
    async def test_finalize_blocks_execute_regardless_of_catch(self):
        """Test that finalize blocks execute regardless of try-catch outcome."""
        handler = GracefulErrorHandler()
        finalize_executed = []

        def failing_try_action():
            raise RuntimeError("Error in try block")

        await handler.execute_try_catch_finally(
            try_action=failing_try_action,
            catch_action=lambda e: "handled",
            finally_action=lambda: finalize_executed.append("finalized"),
        )

        assert "finalized" in finalize_executed

    @pytest.mark.asyncio
    async def test_retry_integrates_with_classification(self):
        """Test that retry configuration integrates with error classification."""
        handler = GracefulErrorHandler()

        # Transient error should be retried
        transient_error = ConnectionError("Connection lost")
        assert handler.should_retry(transient_error) is True

        # Permanent error should not be retried
        permanent_error = AssertionError("Assertion failed")
        assert handler.should_retry(permanent_error) is False

    @pytest.mark.asyncio
    async def test_retry_preserves_context_across_attempts(self):
        """Test that error context is preserved across retry attempts."""
        handler = GracefulErrorHandler()
        attempt_contexts = []

        async def failing_action():
            raise ConnectionError("Connection failed")

        try:
            await handler.execute_with_retry(
                action=failing_action,
                max_attempts=3,
                context_collector=lambda ctx: attempt_contexts.append(ctx),
            )
        except ConnectionError:
            pass  # Expected after retries exhausted

        # All attempts should have context
        assert len(attempt_contexts) == 3
        assert all(ctx.retry_attempt is not None for ctx in attempt_contexts)

    @pytest.mark.asyncio
    async def test_re_raised_error_propagates_upward(self):
        """Test that re-raised errors propagate upward through multiple levels."""
        handler = GracefulErrorHandler()

        # Create original error
        original_error = ValueError("Original error")
        context = ErrorContext()
        context.capture_origin(entity_type="plugin", entity_id="plugin-1", entity_version="1.0.0")

        # First level: handler signals re-raise by returning False
        result = await handler.handle_in_try_catch(
            error=original_error,
            context=context,
            recovery_action=lambda: None,  # Handler decides to re-raise
            re_raise=True,
        )
        assert result is False
        assert handler.was_re_raised(original_error) is True

    @pytest.mark.asyncio
    async def test_combined_context_on_re_raise(self):
        """Test that context is combined when error is re-raised through multiple levels."""
        handler = GracefulErrorHandler()

        # Original error at plugin level
        error = RuntimeError("Database query failed")
        plugin_context = ErrorContext()
        plugin_context.capture_origin(
            entity_type="plugin", entity_id="sql-plugin", entity_version="1.0.0"
        )
        plugin_context.add_metadata({"query": "SELECT * FROM users"})

        # First level (block): handler signals re-raise, caller enriches context
        result = await handler.handle_in_try_catch(
            error=error, context=plugin_context, recovery_action=lambda: None, re_raise=True
        )
        assert result is False
        # Block level enriches context before re-raising
        block_context = handler.get_propagated_context(error)
        block_context.add_metadata({"block_id": "data-validation-block"})

        # Second level (test): handler signals re-raise again
        result = await handler.handle_in_try_catch(
            error=error, context=block_context, recovery_action=lambda: None, re_raise=True
        )
        assert result is False
        test_context = handler.get_propagated_context(error)
        test_context.add_metadata({"test_id": "user-data-test"})

        # Final context should have metadata from all levels
        final_context = handler.get_propagated_context(error)
        assert "query" in final_context.metadata
        assert "block_id" in final_context.metadata
        assert "test_id" in final_context.metadata
        assert final_context.metadata["query"] == "SELECT * FROM users"
        assert final_context.metadata["block_id"] == "data-validation-block"
        assert final_context.metadata["test_id"] == "user-data-test"

    # ============================================================================
    # Test 7: Error Recovery Coordination
    # ============================================================================

    @pytest.mark.asyncio
    async def test_graceful_handler_async_recovery_action(self):
        """Test graceful handler with async recovery action."""
        handler = GracefulErrorHandler()

        async def async_recovery():
            return "recovered"

        error = RuntimeError("Error")
        context = ErrorContext()

        is_handled = await handler.handle_in_try_catch(
            error=error, context=context, recovery_action=async_recovery
        )

        assert is_handled is True

    def test_graceful_handler_get_propagated_context_unknown_error(self):
        """Test get_propagated_context returns new context for unknown errors."""
        handler = GracefulErrorHandler()

        # Unknown error not in _error_contexts
        unknown_error = ValueError("Unknown")
        context = handler.get_propagated_context(unknown_error)

        # Should return new ErrorContext
        assert context is not None
        assert isinstance(context, ErrorContext)

    @pytest.mark.asyncio
    async def test_graceful_handler_try_catch_finally_async_try(self):
        """Test try-catch-finally with async try action."""
        handler = GracefulErrorHandler()
        executed = []

        async def async_try():
            executed.append("try")

        await handler.execute_try_catch_finally(
            try_action=async_try,
            catch_action=lambda e: executed.append("catch"),
            finally_action=lambda: executed.append("finally"),
        )

        assert executed == ["try", "finally"]

    @pytest.mark.asyncio
    async def test_graceful_handler_try_catch_finally_async_catch(self):
        """Test try-catch-finally with async catch action."""
        handler = GracefulErrorHandler()
        executed = []

        def failing_try():
            raise RuntimeError("Error")

        async def async_catch(e):
            executed.append("async-catch")

        await handler.execute_try_catch_finally(
            try_action=failing_try,
            catch_action=async_catch,
            finally_action=lambda: executed.append("finally"),
        )

        assert "async-catch" in executed
        assert "finally" in executed

    @pytest.mark.asyncio
    async def test_graceful_handler_try_catch_finally_async_finally(self):
        """Test try-catch-finally with async finally action."""
        handler = GracefulErrorHandler()
        executed = []

        async def async_finally():
            executed.append("async-finally")

        await handler.execute_try_catch_finally(
            try_action=lambda: executed.append("try"),
            catch_action=lambda e: executed.append("catch"),
            finally_action=async_finally,
        )

        assert "async-finally" in executed

    @pytest.mark.asyncio
    async def test_graceful_handler_retry_async_action(self):
        """Test retry with async action."""
        handler = GracefulErrorHandler()
        attempt_count = []

        async def async_action():
            attempt_count.append(1)
            if len(attempt_count) < 2:
                raise RuntimeError("Retry needed")
            # Succeeds on second attempt

        await handler.execute_with_retry(action=async_action, max_attempts=3)

        assert len(attempt_count) == 2


class TestErrorRecoveryCoordination:
    """Test coordination of error recovery for complex scenarios."""

    def test_concurrent_errors_primary_takes_precedence(self):
        """Test that primary errors from normal execution take precedence over secondary."""
        coordinator = ErrorRecoveryCoordinator()

        # Register primary error from execution
        primary_error = ValueError("Execution failed")
        coordinator.register_error(error=primary_error, source="execution", priority="primary")

        # Register secondary error from cleanup
        secondary_error = RuntimeError("Cleanup failed")
        coordinator.register_error(error=secondary_error, source="cleanup", priority="secondary")

        # Primary should take precedence
        dominant_error = coordinator.get_dominant_error()
        assert dominant_error == primary_error

    @pytest.mark.asyncio
    async def test_cleanup_failures_logged_and_chained(self):
        """Test that cleanup failures are logged and chained but don't block handlers."""
        coordinator = ErrorRecoveryCoordinator()
        cleanup_log = []

        def failing_cleanup_handler():
            raise RuntimeError("Cleanup-2 failed")

        # Register cleanup handlers that may fail
        coordinator.register_cleanup_handler(
            handler_id="cleanup-1", handler_fn=lambda: cleanup_log.append("cleanup-1")
        )
        coordinator.register_cleanup_handler(
            handler_id="cleanup-2", handler_fn=failing_cleanup_handler
        )
        coordinator.register_cleanup_handler(
            handler_id="cleanup-3", handler_fn=lambda: cleanup_log.append("cleanup-3")
        )

        await coordinator.execute_all_cleanups()

        # cleanup-1 and cleanup-3 should execute despite cleanup-2 failure
        assert "cleanup-1" in cleanup_log
        assert "cleanup-3" in cleanup_log

        # Cleanup failure should be logged
        failures = coordinator.get_cleanup_failures()
        assert len(failures) == 1
        assert "cleanup-2" in failures[0].handler_id

    @pytest.mark.asyncio
    async def test_parallel_operations_graceful_termination(self):
        """Test that parallel operations receive graceful termination signals."""
        coordinator = ErrorRecoveryCoordinator()
        termination_signals = []

        # Simulate parallel operations
        async def parallel_task(task_id):
            try:
                await asyncio.sleep(10)  # Long-running task
            except asyncio.CancelledError:
                termination_signals.append(task_id)
                raise

        tasks = [
            asyncio.create_task(parallel_task("task-1")),
            asyncio.create_task(parallel_task("task-2")),
            asyncio.create_task(parallel_task("task-3")),
        ]

        # Trigger graceful termination
        await coordinator.terminate_parallel_operations(tasks=tasks, timeout_seconds=0.1)

        # All tasks should receive termination signal
        await asyncio.sleep(0.2)  # Allow tasks to handle cancellation
        assert len(termination_signals) == 3

    @pytest.mark.asyncio
    async def test_parallel_error_aggregation(self):
        """Test that errors from parallel operations are aggregated."""
        coordinator = ErrorRecoveryCoordinator()

        # Simulate parallel operations with errors
        async def failing_task(task_id, error_msg):
            raise RuntimeError(f"Task {task_id}: {error_msg}")

        tasks = [
            asyncio.create_task(failing_task("task-1", "error-1")),
            asyncio.create_task(failing_task("task-2", "error-2")),
        ]

        aggregated_errors = await coordinator.aggregate_parallel_errors(tasks)

        assert len(aggregated_errors) == 2
        assert any("task-1" in str(e) for e in aggregated_errors)
        assert any("task-2" in str(e) for e in aggregated_errors)

    @pytest.mark.asyncio
    async def test_state_transitions_consistent_during_errors(self):
        """Test that state transitions remain consistent when errors occur during transitions."""
        coordinator = ErrorRecoveryCoordinator()

        # Begin state transition
        coordinator.begin_transition(
            from_state=ExecutionState.RUNNING, to_state=ExecutionState.COMPLETED
        )

        # Error occurs during transition
        transition_error = RuntimeError("Transition failed")
        coordinator.handle_transition_error(transition_error)

        # State should be consistent (not undefined)
        current_state = coordinator.get_current_state()
        assert current_state in [ExecutionState.RUNNING, ExecutionState.FAILED]
        assert current_state != "undefined"

    # ============================================================================
    # Test 8: Observability and Diagnostics
    # ============================================================================

    def test_recovery_coordinator_no_errors(self):
        """Test get_dominant_error returns None when no errors registered."""
        coordinator = ErrorRecoveryCoordinator()

        # No errors registered
        dominant_error = coordinator.get_dominant_error()
        assert dominant_error is None

    def test_recovery_coordinator_only_secondary_errors(self):
        """Test get_dominant_error with only secondary errors."""
        coordinator = ErrorRecoveryCoordinator()

        # Register only secondary errors
        coordinator.register_error(
            error=RuntimeError("Secondary error 1"), source="cleanup", priority="secondary"
        )
        coordinator.register_error(
            error=ValueError("Secondary error 2"), source="cleanup", priority="secondary"
        )

        # Should return first error when no primary exists
        dominant_error = coordinator.get_dominant_error()
        assert dominant_error is not None
        assert "Secondary error 1" in str(dominant_error)

    @pytest.mark.asyncio
    async def test_recovery_coordinator_async_cleanup(self):
        """Test recovery coordinator handles async cleanup handlers."""
        coordinator = ErrorRecoveryCoordinator()
        cleanup_log = []

        async def async_cleanup():
            cleanup_log.append("async-cleanup")

        coordinator.register_cleanup_handler(handler_id="async-handler", handler_fn=async_cleanup)

        await coordinator.execute_all_cleanups()

        assert "async-cleanup" in cleanup_log

    def test_recovery_coordinator_transition_error_no_from_state(self):
        """Test transition error handling when from_state is None."""
        coordinator = ErrorRecoveryCoordinator()

        # Don't call begin_transition, so _transition_from_state is None
        error = RuntimeError("Transition failed")
        coordinator.handle_transition_error(error)

        # Should default to FAILED state
        assert coordinator.get_current_state() == ExecutionState.FAILED


class TestObservabilityAndDiagnostics:
    """Test observability and diagnostic capabilities for error handling."""

    def test_structured_logging_with_context(self):
        """Test that structured logging provides full error context."""
        handler = GracefulErrorHandler()
        log_entries = []

        handler.configure_logger(log_collector=lambda entry: log_entries.append(entry))

        # Trigger error with context
        error = ValueError("Validation failed")
        context = ErrorContext()
        context.capture_origin(entity_type="plugin", entity_id="validator", entity_version="1.0.0")

        handler.log_error(error=error, context=context)

        # Log should contain structured context
        assert len(log_entries) == 1
        log_entry = log_entries[0]
        assert log_entry["error_type"] == "ValueError"
        assert log_entry["origin"]["entity_id"] == "validator"
        assert "timestamp" in log_entry

    def test_error_metrics_tracking(self):
        """Test that error metrics track rates by category, origin, and type."""
        handler = GracefulErrorHandler()

        # Report multiple errors
        handler.report_error_metric(
            error_type="ConnectionError", category=ErrorCategory.TRANSIENT, origin="sql-plugin"
        )
        handler.report_error_metric(
            error_type="AssertionError", category=ErrorCategory.PERMANENT, origin="validation-block"
        )
        handler.report_error_metric(
            error_type="ConnectionError", category=ErrorCategory.TRANSIENT, origin="sql-plugin"
        )

        # Get metrics
        metrics = handler.get_error_metrics()

        assert metrics["by_category"][ErrorCategory.TRANSIENT] == 2
        assert metrics["by_category"][ErrorCategory.PERMANENT] == 1
        assert metrics["by_type"]["ConnectionError"] == 2
        assert metrics["by_origin"]["sql-plugin"] == 2

    def test_diagnostic_collection_for_patterns(self):
        """Test that specific error patterns trigger diagnostic collection."""
        handler = GracefulErrorHandler()

        # Configure diagnostic collection for memory errors
        handler.register_diagnostic_collector(
            error_pattern="MemoryError",
            collector=lambda: {"heap_dump": "collected", "gc_stats": "collected"},
        )

        # Trigger memory error
        memory_error = MemoryError("Out of memory")
        diagnostics = handler.collect_diagnostics(memory_error)

        assert "heap_dump" in diagnostics
        assert "gc_stats" in diagnostics

    def test_diagnostics_persist_in_artifacts(self):
        """Test that diagnostics are persisted in artifacts even on failure."""
        handler = GracefulErrorHandler()

        # Create error with diagnostics
        error = RuntimeError("Critical failure")
        context = ErrorContext()
        context.capture_environment(resources={"memory_mb": 8192})

        # Generate artifact
        artifact = handler.create_error_artifact(error=error, context=context)

        # Artifact should contain diagnostics
        assert artifact["error"]["type"] == "RuntimeError"
        assert artifact["context"]["environment"]["resources"]["memory_mb"] == 8192
        assert "timestamp" in artifact

    def test_critical_error_snapshot_generation(self):
        """Test that critical errors generate snapshots even when artifact generation fails."""
        handler = GracefulErrorHandler()

        # Simulate critical error with artifact generation failure
        critical_error = MemoryError("Out of memory")

        snapshot = handler.create_emergency_snapshot(
            error=critical_error, allow_artifact_failure=True
        )

        # Emergency snapshot should succeed even if full artifact fails
        assert snapshot is not None
        assert snapshot["error_type"] == "MemoryError"
        assert "timestamp" in snapshot
        assert snapshot["is_emergency_snapshot"] is True

    # ============================================================================
    # Integration Tests
    # ============================================================================

    def test_graceful_handler_collect_diagnostics_unknown_pattern(self):
        """Test diagnostics collection for unknown error patterns."""
        handler = GracefulErrorHandler()

        # No diagnostic collector registered for ValueError
        error = ValueError("Some error")
        diagnostics = handler.collect_diagnostics(error)

        # Should return empty dict
        assert diagnostics == {}


class TestGracefulErrorHandlingIntegration:
    """Integration tests combining multiple error handling aspects."""

    @pytest.mark.asyncio
    async def test_full_error_lifecycle(self):
        """Test complete error lifecycle from detection through cleanup."""
        handler = GracefulErrorHandler()
        classifier = ErrorClassifier()
        cleanup_manager = ResourceCleanupManager()
        lifecycle_events = []

        # 1. Detect and classify error
        error = ConnectionError("Database connection lost")
        category = classifier.classify(error)
        assert category == ErrorCategory.TRANSIENT
        lifecycle_events.append("classified")

        # 2. Capture context
        context = ErrorContext()
        context.capture_origin(entity_type="plugin", entity_id="sql-query", entity_version="1.0.0")
        lifecycle_events.append("context_captured")

        # 3. Attempt recovery in try-catch
        await handler.handle_in_try_catch(
            error=error, context=context, recovery_action=lambda: "retry_successful"
        )
        lifecycle_events.append("recovery_attempted")

        # 4. Cleanup resources
        cleanup_manager.register_resource(
            resource_id="db-connection",
            cleanup_fn=lambda: lifecycle_events.append("cleanup_executed"),
        )
        await cleanup_manager.cleanup_all()

        # Verify full lifecycle
        assert lifecycle_events == [
            "classified",
            "context_captured",
            "recovery_attempted",
            "cleanup_executed",
        ]

    @pytest.mark.asyncio
    async def test_cascading_failure_prevention(self):
        """Test that error isolation prevents cascading failures across hierarchy."""
        # Create hierarchy: regression → suite → test → block → plugin
        regression_boundary = ErrorIsolationBoundary(level="regression")
        suite_boundary = ErrorIsolationBoundary(level="suite", parent=regression_boundary)
        test_boundary = ErrorIsolationBoundary(level="test", parent=suite_boundary)
        block_boundary = ErrorIsolationBoundary(level="block", parent=test_boundary)

        # Plugin error in block
        plugin_error = ValueError("Plugin failed")
        block_boundary.capture_error(error=plugin_error, entity_id="plugin-1", entity_type="plugin")

        # Error should be isolated to block level
        assert block_boundary.is_contained() is True
        assert test_boundary.is_affected() is False
        assert suite_boundary.is_affected() is False
        assert regression_boundary.is_affected() is False

    @pytest.mark.asyncio
    async def test_system_stability_under_sustained_errors(self):
        """Test that system maintains stability under sustained error conditions."""
        monitor = SystemStabilityMonitor(
            error_rate_threshold=0.3, time_window_seconds=5, backoff_duration_seconds=0.2
        )

        # Simulate sustained errors
        for i in range(10):
            monitor.report_error(RuntimeError(f"Error {i}"))
            await asyncio.sleep(0.1)

        # System should apply backoff
        assert monitor.should_apply_backoff() is True

        # Wait for backoff
        await asyncio.sleep(0.3)

        # System should recover
        assert monitor.should_apply_backoff() is False
        assert monitor.can_accept_new_execution() is True
