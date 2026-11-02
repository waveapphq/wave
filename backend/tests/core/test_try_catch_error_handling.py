"""
Unit tests for try-catch error handling (REQ-3.2.2.6).

Tests the try-catch construct's error handling semantics including error context capture,
handler execution with error variables, error transformation, and re-raising capabilities.

Requirements tested:
- REQ-3.2.2.6: Try-catch error handling per block
  - Scope of Protection (plugin failures, assertions, timeouts, resource errors)
  - Error Context Capture (type, message, origin, stack, variables, results, timestamp)
  - Handler Execution Model (error object variables)
  - Nested handlers (error classification and causality chains)
  - Error Transformation and Re-raising (inspect, modify, propagate)
"""

from datetime import datetime

from wavecore.models.enums import ExecutionState

# ============================================================================
# Test Suite 1: Error Context Capture
# ============================================================================


class TestErrorContextCapture:
    """
    Test comprehensive error context capture when errors are intercepted.

    When a block encounters an error within a try construct, the engine must
    capture extensive diagnostic context including error type, message, origin
    location, execution stack trace, variable scope snapshots with secret masking,
    partial results, and timestamp information.
    """

    def test_error_context_captures_error_type(self):
        """Test error context captures the error type classification (transient/permanent)."""
        from wavecore.core.errors.error_handling import ErrorClassifier, ErrorContext

        # Create an error and classify it
        error = ValueError("Invalid input parameter")
        classifier = ErrorClassifier()
        category = classifier.classify(error)

        # Create error context
        context = ErrorContext()
        context.capture_origin(entity_type="plugin", entity_id="test-plugin")

        # Verify error type is captured
        assert category.error_type == "ValueError"
        assert not category.is_retryable  # ValueError is permanent

    def test_error_context_captures_human_readable_message(self):
        """Test error context captures human-readable error message."""
        from wavecore.core.errors.error_handling import ErrorContext

        error = RuntimeError("Database connection failed: timeout exceeded")
        context = ErrorContext()
        context.capture_origin(entity_type="block", entity_id="db-block")
        context.add_to_chain(error)

        # Verify message is captured
        artifact = context.to_artifact()
        assert len(artifact["error_chain"]) == 1
        assert (
            artifact["error_chain"][0]["message"] == "Database connection failed: timeout exceeded"
        )

    def test_error_context_captures_origin_location(self):
        """Test error context captures origin location (block/plugin)."""
        from wavecore.core.errors.error_handling import ErrorContext

        context = ErrorContext()
        context.capture_origin(
            entity_type="plugin",
            entity_id="ssh-connect",
            entity_version="1.2.0",
            hierarchy_path=["regression-1", "suite-1", "test-1", "block-1"],
        )

        artifact = context.to_artifact()
        assert artifact["origin"]["entity_type"] == "plugin"
        assert artifact["origin"]["entity_id"] == "ssh-connect"
        assert artifact["origin"]["entity_version"] == "1.2.0"
        assert artifact["origin"]["hierarchy_path"] == [
            "regression-1",
            "suite-1",
            "test-1",
            "block-1",
        ]

    def test_error_context_captures_execution_stack_trace(self):
        """Test error context captures execution stack trace information."""
        from wavecore.core.errors.error_handling import ErrorContext

        # Create error with stack
        try:

            def inner_function():
                raise ValueError("Inner error")

            inner_function()
        except ValueError as e:
            error = e

        context = ErrorContext()
        context.add_to_chain(error)

        # Verify error is in chain
        chain = context.get_error_chain()
        assert len(chain) == 1
        assert chain[0].error_type == "ValueError"
        assert str(chain[0].error) == "Inner error"

    def test_error_context_captures_variable_scope_snapshots(self):
        """Test error context captures variable scope snapshots at error time."""
        from wavecore.core.errors.error_handling import ErrorContext

        context = ErrorContext()
        variables = {
            "user_id": "12345",
            "connection_string": "postgresql://localhost",
            "retry_count": 3,
        }
        context.capture_execution_state(
            variables=variables,
            current_state=ExecutionState.RUNNING,
        )

        artifact = context.to_artifact()
        assert artifact["execution_state"]["variables"]["user_id"] == "12345"
        assert (
            artifact["execution_state"]["variables"]["connection_string"]
            == "postgresql://localhost"
        )
        assert artifact["execution_state"]["variables"]["retry_count"] == 3

    def test_error_context_never_masks_by_name(self):
        """There is no name-heuristic masker; snapshots keep raw values."""
        from wavecore.core.errors.error_handling import ErrorContext

        context = ErrorContext()
        variables = {
            "username": "admin",
            "password": "super_secret_password",
            "api_key": "sk-1234567890abcdef",
            "database_host": "db.example.com",
            "secret_token": "my-secret-token",
        }
        context.capture_execution_state(variables=variables)

        artifact = context.to_artifact()
        assert artifact["execution_state"]["variables"]["username"] == "admin"
        assert artifact["execution_state"]["variables"]["database_host"] == "db.example.com"
        assert artifact["execution_state"]["variables"]["password"] == "super_secret_password"
        assert artifact["execution_state"]["variables"]["api_key"] == "sk-1234567890abcdef"
        assert artifact["execution_state"]["variables"]["secret_token"] == "my-secret-token"
        assert not hasattr(context, "_mask_secrets")

    def test_error_context_captures_partial_results(self):
        """Test error context captures partial results from failed execution."""
        from wavecore.core.errors.error_handling import ErrorContext

        context = ErrorContext()
        partial_results = {
            "processed_records": 150,
            "failed_at_record": 151,
            "successful_operations": ["insert", "update", "delete"],
        }
        context.capture_execution_state(partial_results=partial_results)

        artifact = context.to_artifact()
        assert artifact["execution_state"]["partial_results"]["processed_records"] == 150
        assert artifact["execution_state"]["partial_results"]["failed_at_record"] == 151
        assert "insert" in artifact["execution_state"]["partial_results"]["successful_operations"]

    def test_error_context_captures_timestamp(self):
        """Test error context captures timestamp of error occurrence."""
        from datetime import UTC

        from wavecore.core.errors.error_handling import ErrorContext

        before = datetime.now(UTC)

        error = RuntimeError("Test error")
        context = ErrorContext()
        context.add_to_chain(error)

        after = datetime.now(UTC)

        chain = context.get_error_chain()
        assert len(chain) == 1
        # Timestamp should be between before and after
        assert before <= chain[0].timestamp <= after

    def test_error_context_preserved_in_artifacts(self):
        """Test error context is preserved in artifacts regardless of handling outcome."""
        from wavecore.core.errors.error_handling import ErrorContext

        error = ValueError("Invalid configuration")
        context = ErrorContext()
        context.capture_origin(entity_type="block", entity_id="config-block")
        context.capture_execution_state(
            variables={"config_file": "/etc/app.conf"},
            current_state=ExecutionState.FAILED,
        )
        context.add_to_chain(error)

        # Convert to artifact (for storage/logging)
        artifact = context.to_artifact()

        # Verify complete context is preserved
        assert artifact["origin"]["entity_type"] == "block"
        assert artifact["origin"]["entity_id"] == "config-block"
        assert artifact["execution_state"]["variables"]["config_file"] == "/etc/app.conf"
        assert artifact["execution_state"]["current_state"] == "FAILED"
        assert len(artifact["error_chain"]) == 1
        assert artifact["error_chain"][0]["error_type"] == "ValueError"


# ============================================================================
# Test Suite 2: Error Variables in Catch Handler
# ============================================================================


class TestErrorVariablesInCatchHandler:
    """
    Test error variables are accessible within catch handler execution.

    The catch handler must receive structured error object containing comprehensive
    error information, accessible via standard variable references within the handler's
    variable scope. This enables inspection, logging, and decision-making based on
    error details.
    """

    def test_catch_handler_receives_error_object(self):
        """Test catch handler receives error object as special variable."""
        from wavecore.core.errors.error_handling import ErrorContext

        error = ValueError("Invalid configuration")
        error_context = ErrorContext()
        error_context.capture_origin(entity_type="block", entity_id="config-block")
        error_context.capture_execution_state(
            variables={"config_file": "/etc/app.conf"},
            current_state=ExecutionState.FAILED,
        )
        error_context.add_to_chain(error)

        handler_context = error_context.get_handler_context()

        assert handler_context["origin"]["entity_type"] == "block"
        assert handler_context["origin"]["entity_id"] == "config-block"
        assert handler_context["execution_state"]["variables"]["config_file"] == "/etc/app.conf"
        assert handler_context["execution_state"]["current_state"] == ExecutionState.FAILED

    def test_error_object_contains_error_type(self):
        """Test error object contains error type for handler inspection."""
        from wavecore.core.errors.error_handling import ErrorClassifier, ErrorContext

        error = ConnectionError("Network timeout")
        classifier = ErrorClassifier()
        category = classifier.classify(error)

        context = ErrorContext()
        context.add_to_chain(error)

        # Verify error type is available
        assert category.error_type == "ConnectionError"
        assert category.is_retryable  # ConnectionError is transient

    def test_error_object_contains_error_message(self):
        """Test error object contains human-readable message for logging."""
        from wavecore.core.errors.error_handling import ErrorContext

        error = ValueError("Invalid port number: must be between 1 and 65535")
        context = ErrorContext()
        context.add_to_chain(error)

        # Verify error chain contains message
        chain = context.get_error_chain()
        assert len(chain) == 1
        assert str(chain[0].error) == "Invalid port number: must be between 1 and 65535"
        assert chain[0].error_type == "ValueError"

        # Verify handler context provides error information
        handler_context = context.get_handler_context()
        assert handler_context is not None
        # Handler can access error details through context methods

    def test_error_object_contains_origin_information(self):
        """Test error object contains origin information (block/plugin location)."""
        from wavecore.core.errors.error_handling import ErrorContext

        context = ErrorContext()
        context.capture_origin(
            entity_type="plugin",
            entity_id="http-request",
            entity_version="2.1.0",
        )

        handler_context = context.get_handler_context()
        assert handler_context["origin"]["entity_type"] == "plugin"
        assert handler_context["origin"]["entity_id"] == "http-request"
        assert handler_context["origin"]["entity_version"] == "2.1.0"

    def test_error_object_contains_execution_state(self):
        """Test error object contains execution state at error time."""
        from wavecore.core.errors.error_handling import ErrorContext

        context = ErrorContext()
        context.capture_execution_state(
            variables={"iteration": 5, "max_retries": 3},
            current_state=ExecutionState.FAILED,
        )

        handler_context = context.get_handler_context()
        assert handler_context["execution_state"]["variables"]["iteration"] == 5
        assert handler_context["execution_state"]["variables"]["max_retries"] == 3
        assert handler_context["execution_state"]["current_state"] == ExecutionState.FAILED

    def test_catch_handler_can_inspect_error_properties(self):
        """Test catch handler can read and inspect error properties for decisions."""
        from wavecore.core.errors.error_handling import ErrorClassifier

        # Simulate handler inspecting error to decide on action
        error = TimeoutError("Request timeout after 30 seconds")
        classifier = ErrorClassifier()
        category = classifier.classify(error)

        # Handler logic: retry if transient, fail if permanent
        should_retry = category.is_retryable
        assert should_retry is True  # TimeoutError is transient

    def test_catch_handler_can_log_error_details(self):
        """Test catch handler can extract error details for logging."""
        from wavecore.core.errors.error_handling import ErrorContext

        error = RuntimeError("File processing failed")
        context = ErrorContext()
        context.capture_origin(entity_type="block", entity_id="file-processor")
        context.capture_execution_state(variables={"filename": "data.csv", "line_number": 42})
        context.add_to_chain(error)

        # Simulate handler logging
        log_entry = {
            "error_message": str(error),
            "origin": context.origin.entity_id if context.origin else None,
            "filename": context.execution_state.variables.get("filename"),
            "line": context.execution_state.variables.get("line_number"),
        }

        assert log_entry["error_message"] == "File processing failed"
        assert log_entry["origin"] == "file-processor"
        assert log_entry["filename"] == "data.csv"
        assert log_entry["line"] == 42


# ============================================================================
# Test Suite 3: Error Transformation and Re-raising
# ============================================================================


class TestErrorTransformationAndReRaising:
    """
    Test error transformation and re-raising capabilities in catch handlers.

    Catch handlers can inspect error context and raise modified or new errors,
    enabling conversion of low-level errors to domain-specific errors, aggregation
    of retry failures, enrichment with diagnostic context, or severity adjustments.
    Re-raising propagates errors upward while preserving error chains for causality.
    """

    def test_catch_handler_can_transform_error_type(self):
        """Test catch handler can convert low-level error to domain-specific error."""
        from wavecore.core.errors.error_handling import ErrorContext

        # Original low-level error
        original_error = ConnectionError("Connection refused")

        # Handler transforms to domain error
        context = ErrorContext()
        context.capture_origin(entity_type="plugin", entity_id="db-connect")
        context.add_to_chain(original_error)

        # Transformed error
        transformed_error = RuntimeError("Database unavailable: connection refused")
        context.add_to_chain(transformed_error, caused_by=original_error)

        # Verify causality chain
        chain = context.get_error_chain()
        assert len(chain) == 2
        assert chain[0].error_type == "ConnectionError"
        assert chain[1].error_type == "RuntimeError"
        assert chain[1].caused_by == chain[0]

    def test_catch_handler_can_enrich_error_with_context(self):
        """Test catch handler can add diagnostic context to error before re-raising."""
        from wavecore.core.errors.error_handling import ErrorContext

        original_error = ValueError("Invalid value")

        context = ErrorContext()
        context.capture_execution_state(
            variables={"input_value": "abc123", "expected_type": "integer"}
        )
        context.add_to_chain(original_error)

        # Handler enriches error
        enriched_message = "Invalid value 'abc123': expected integer, got string"
        enriched_error = ValueError(enriched_message)
        context.add_to_chain(enriched_error, caused_by=original_error)

        # Verify enrichment
        chain = context.get_error_chain()
        assert str(chain[1].error) == enriched_message

    def test_catch_handler_can_aggregate_retry_failures(self):
        """Test catch handler can aggregate multiple retry failures into single error."""
        from wavecore.core.errors.error_handling import ErrorContext

        # Simulate multiple retry failures
        context = ErrorContext()

        retry_errors = [
            TimeoutError("Attempt 1: timeout"),
            TimeoutError("Attempt 2: timeout"),
            TimeoutError("Attempt 3: timeout"),
        ]

        for i, error in enumerate(retry_errors):
            context.add_metadata({"retry_attempt": i + 1})
            context.add_to_chain(error)

        # Handler aggregates
        aggregated = RuntimeError(
            f"Failed after {len(retry_errors)} retries: all attempts timed out"
        )
        context.add_to_chain(aggregated)

        # Verify aggregation
        chain = context.get_error_chain()
        assert len(chain) == 4  # 3 retries + 1 aggregated
        assert "Failed after 3 retries" in str(chain[-1].error)

    def test_catch_handler_can_adjust_error_severity(self):
        """Test catch handler can adjust error severity (e.g., warning to error)."""
        from wavecore.core.errors.error_handling import ErrorCategory, ErrorClassifier

        # Original low-severity error
        warning_error = RuntimeError("Temporarily unavailable")

        classifier = ErrorClassifier()
        original_category = classifier.classify(warning_error)
        assert original_category == ErrorCategory.TRANSIENT

        # Handler escalates severity
        critical_error = RuntimeError("Service unavailable: critical system failure")
        # Custom classification
        classifier.register_rule("critical system failure", ErrorCategory.CRITICAL)
        escalated_category = classifier.classify(critical_error)

        assert escalated_category == ErrorCategory.CRITICAL
        assert escalated_category.requires_escalation

    def test_catch_handler_can_re_raise_original_error(self):
        """Test catch handler can re-raise original error unmodified."""
        from wavecore.core.errors.error_handling import ErrorContext, GracefulErrorHandler

        original_error = ValueError("Original error")
        context = ErrorContext()
        context.add_to_chain(original_error)

        handler = GracefulErrorHandler()

        # Handler signals re-raise by returning False
        async def recovery():
            pass

        import asyncio

        result = asyncio.run(
            handler.handle_in_try_catch(
                original_error,
                context,
                recovery,
                re_raise=True,
            )
        )
        assert result is False

    def test_catch_handler_can_re_raise_modified_error(self):
        """Test catch handler can raise new error to propagate modified version."""
        from wavecore.core.errors.error_handling import ErrorContext

        original_error = ConnectionError("Connection lost")
        context = ErrorContext()
        context.add_to_chain(original_error)

        # Handler creates and raises modified error
        modified_error = RuntimeError("Network error: connection lost during data transfer")
        context.add_to_chain(modified_error, caused_by=original_error)

        # Verify error chain preserved
        chain = context.get_error_chain()
        assert len(chain) == 2
        assert chain[0].error == original_error
        assert chain[1].error == modified_error
        assert chain[1].caused_by == chain[0]

    def test_error_chain_preserves_causality(self):
        """Test error chains preserve causality for root cause analysis."""
        from wavecore.core.errors.error_handling import ErrorContext

        # Build error chain: network -> timeout -> application
        network_error = ConnectionError("Network unreachable")
        timeout_error = TimeoutError("Operation timeout")
        app_error = RuntimeError("Application failed to start")

        context = ErrorContext()
        context.add_to_chain(network_error)
        context.add_to_chain(timeout_error, caused_by=network_error)
        context.add_to_chain(app_error, caused_by=timeout_error)

        # Verify chain structure
        chain = context.get_error_chain()
        assert len(chain) == 3
        assert chain[0].caused_by is None  # Root cause
        assert chain[1].caused_by == chain[0]
        assert chain[2].caused_by == chain[1]

    def test_catch_handler_conditional_re_raise_by_type(self):
        """Test catch handler can conditionally re-raise based on error type."""
        from wavecore.core.errors.error_handling import ErrorClassifier

        classifier = ErrorClassifier()

        # Transient error - handler recovers (doesn't re-raise)
        transient = TimeoutError("Timeout")
        category = classifier.classify(transient)
        should_re_raise = not category.is_retryable
        assert should_re_raise is False

        # Permanent error - handler re-raises
        permanent = ValueError("Invalid configuration")
        category = classifier.classify(permanent)
        should_re_raise = not category.is_retryable
        assert should_re_raise is True

    def test_re_raised_error_tracked_by_handler(self):
        """Test re-raised errors are tracked by error handler."""
        from wavecore.core.errors.error_handling import ErrorContext, GracefulErrorHandler

        error = RuntimeError("Test error")
        context = ErrorContext()

        handler = GracefulErrorHandler()

        # Handler signals re-raise by returning False
        async def recovery():
            pass

        import asyncio

        result = asyncio.run(
            handler.handle_in_try_catch(
                error,
                context,
                recovery,
                re_raise=True,
            )
        )
        assert result is False

        # Verify handler tracked re-raise
        assert handler.was_re_raised(error)

    def test_graceful_error_handler_integrates_with_try_catch(self):
        """Test GracefulErrorHandler integrates with try-catch execution flow."""
        import asyncio

        from wavecore.core.errors.error_handling import ErrorContext, GracefulErrorHandler

        handler = GracefulErrorHandler()
        error = ValueError("Invalid input")
        context = ErrorContext()
        context.capture_origin(entity_type="block", entity_id="validation-block")
        context.add_to_chain(error)

        # Test successful recovery without re-raise
        recovery_executed = False

        async def recovery_action():
            nonlocal recovery_executed
            recovery_executed = True

        # Execute recovery without re-raising
        result = asyncio.run(
            handler.handle_in_try_catch(error, context, recovery_action, re_raise=False)
        )

        # Verify recovery was executed and error was handled
        assert recovery_executed is True
        assert result is True  # Successful handling
        assert not handler.should_propagate(error)

        # Verify error context was stored
        propagated_context = handler.get_propagated_context(error)
        assert propagated_context.origin.entity_id == "validation-block"


# ============================================================================
# Test Suite 5: Integration with Hierarchy and Finalize
# ============================================================================


class TestIntegrationWithHierarchy:
    """
    Test try-catch integration with hierarchical structure and finalize blocks.

    Try-catch constructs can nest for layered handling, appear at multiple hierarchy
    levels, and coordinate with finalize blocks that execute regardless of error
    handling outcome.
    """

    def test_nested_try_catch_inner_handles_specific_errors(self):
        """Test nested try-catch where inner construct handles specific errors."""
        from wavecore.core.errors.error_handling import (
            ErrorClassifier,
            ErrorContext,
        )

        # Simulate nested try-catch: outer for general errors, inner for specific errors
        error = TimeoutError("Network timeout")
        classifier = ErrorClassifier()
        category = classifier.classify(error)

        # Inner try-catch handles transient errors (like timeouts)
        if category.is_retryable:
            # Inner handler processes the error
            inner_context = ErrorContext()
            inner_context.capture_origin(entity_type="plugin", entity_id="http-request")
            inner_context.add_to_chain(error)

            # Verify inner handler can handle this error type
            from wavecore.core.errors.error_handling import ErrorCategory

            assert category == ErrorCategory.TRANSIENT
            assert inner_context.origin.entity_id == "http-request"

            # Error handled by inner catch, does not propagate to outer
            error_handled = True
        else:
            error_handled = False

        # Verify inner handler successfully handled the error
        assert error_handled is True

    def test_nested_try_catch_outer_handles_unhandled_errors(self):
        """Test nested try-catch where outer construct catches unhandled inner errors."""
        from wavecore.core.errors.error_handling import (
            ErrorCategory,
            ErrorClassifier,
            ErrorContext,
            GracefulErrorHandler,
        )

        # Permanent error that inner handler cannot handle
        error = ValueError("Invalid configuration parameter")
        classifier = ErrorClassifier()
        category = classifier.classify(error)

        # Inner try-catch only handles transient errors
        inner_handled = False
        if category.is_retryable:
            inner_handled = True

        # Verify inner did not handle this permanent error
        assert inner_handled is False
        assert category == ErrorCategory.PERMANENT

        # Error propagates to outer catch
        outer_context = ErrorContext()
        outer_context.capture_origin(entity_type="test", entity_id="outer-test")
        outer_context.add_to_chain(error)

        # Outer handler receives propagated error
        handler = GracefulErrorHandler()
        assert handler.should_propagate(error) is True

        # Verify outer catch can inspect the error
        propagated_context = handler.get_propagated_context(error)
        assert propagated_context is not None

    def test_error_chain_preserved_through_nested_handlers(self):
        """Test error causality chain is preserved through nested try-catch handlers."""
        from wavecore.core.errors.error_handling import ErrorContext

        # Simulate nested error handling with causality chain
        root_error = ConnectionError("Network failure")
        intermediate_error = TimeoutError("Operation timeout due to network issue")
        final_error = RuntimeError("Service unavailable")

        # Inner try-catch captures and transforms error
        inner_context = ErrorContext()
        inner_context.capture_origin(entity_type="plugin", entity_id="network-plugin")
        inner_context.add_to_chain(root_error)
        inner_context.add_to_chain(intermediate_error, caused_by=root_error)

        # Outer try-catch receives transformed error and adds to chain
        outer_context = ErrorContext()
        outer_context.capture_origin(entity_type="block", entity_id="service-block")

        # Transfer inner chain to outer context
        for node in inner_context.get_error_chain():
            if node.caused_by:
                outer_context.add_to_chain(node.error, caused_by=node.caused_by.error)
            else:
                outer_context.add_to_chain(node.error)

        # Add final transformation at outer level
        outer_context.add_to_chain(final_error, caused_by=intermediate_error)

        # Verify complete causality chain is preserved
        chain = outer_context.get_error_chain()
        assert len(chain) == 3
        assert chain[0].error_type == "ConnectionError"  # Root cause
        assert chain[1].error_type == "TimeoutError"  # Intermediate
        assert chain[2].error_type == "RuntimeError"  # Final transformed error
        assert chain[1].caused_by == chain[0]  # Causality preserved
        assert chain[2].caused_by == chain[1]  # Causality preserved


# ============================================================================
# Test Suite 6: Scope of Protection
# ============================================================================


class TestScopeOfProtection:
    """
    Test which error types are protected by try-catch construct.

    Try-catch protects against operational errors (plugin failures, assertion
    failures, timeouts, resource unavailability) but NOT system-level errors
    (engine failures, memory exhaustion, context corruption) which trigger
    emergency shutdown.
    """

    def test_try_catch_protects_plugin_failures(self):
        """Test try-catch intercepts plugin execution failures."""
        from wavecore.core.errors.error_handling import ErrorCategory, ErrorClassifier, ErrorContext

        # Simulate plugin failure
        plugin_error = RuntimeError("Plugin execution failed: invalid input")
        classifier = ErrorClassifier()
        category = classifier.classify(plugin_error)

        # Verify plugin failure is catchable (permanent error)
        assert category == ErrorCategory.PERMANENT
        assert not category.is_retryable

        # Create error context for plugin failure
        context = ErrorContext()
        context.capture_origin(
            entity_type="plugin",
            entity_id="data-processor",
            entity_version="2.1.0",
        )
        context.add_to_chain(plugin_error)

        # Verify error context captures plugin failure
        artifact = context.to_artifact()
        assert artifact["origin"]["entity_type"] == "plugin"
        assert artifact["origin"]["entity_id"] == "data-processor"
        assert len(artifact["error_chain"]) == 1
        assert artifact["error_chain"][0]["error_type"] == "RuntimeError"

    def test_try_catch_protects_assertion_failures(self):
        """Test try-catch intercepts assertion failures."""
        from wavecore.core.errors.error_handling import ErrorCategory, ErrorClassifier

        assertion_error = AssertionError("Expected value 10, got 5")
        classifier = ErrorClassifier()
        category = classifier.classify(assertion_error)

        # Assertion failures are permanent errors
        assert category == ErrorCategory.PERMANENT
        assert not category.is_retryable

    def test_try_catch_protects_timeout_errors(self):
        """Test try-catch intercepts timeout errors."""
        from wavecore.core.errors.error_handling import ErrorCategory, ErrorClassifier

        timeout_error = TimeoutError("Operation timeout after 30 seconds")
        classifier = ErrorClassifier()
        category = classifier.classify(timeout_error)

        # Timeouts are transient errors
        assert category == ErrorCategory.TRANSIENT
        assert category.is_retryable

    def test_try_catch_protects_resource_unavailability(self):
        """Test try-catch intercepts resource unavailability errors."""
        from wavecore.core.errors.error_handling import ErrorCategory, ErrorClassifier

        resource_error = ConnectionError("Database connection pool exhausted")
        classifier = ErrorClassifier()
        category = classifier.classify(resource_error)

        # Resource errors are transient
        assert category == ErrorCategory.TRANSIENT
        assert category.is_retryable

    def test_system_errors_not_catchable(self):
        """Test system-level errors bypass try-catch and trigger emergency shutdown."""
        from wavecore.core.errors.error_handling import ErrorCategory, ErrorClassifier

        memory_error = MemoryError("Out of memory")
        classifier = ErrorClassifier()
        category = classifier.classify(memory_error)

        # Memory errors are critical, should not be caught
        assert category == ErrorCategory.CRITICAL
        assert category.requires_escalation

    def test_engine_corruption_not_catchable(self):
        """Test engine corruption errors bypass try-catch."""
        from wavecore.core.errors.error_handling import ErrorCategory, ErrorClassifier

        corruption_error = RuntimeError("Engine corruption detected")
        classifier = ErrorClassifier()
        category = classifier.classify(corruption_error)

        # Engine corruption is critical
        assert category == ErrorCategory.CRITICAL
        assert category.requires_escalation

    def test_error_matches_innermost_handler(self):
        """Test errors match to innermost applicable try-catch handler."""
        from wavecore.core.errors.error_handling import ErrorIsolationBoundary

        # Create nested error isolation boundaries
        outer_boundary = ErrorIsolationBoundary(level="test", entity_id="outer-test")
        inner_boundary = ErrorIsolationBoundary(
            level="block", entity_id="inner-block", parent=outer_boundary
        )

        # Register try-catch handler at inner boundary
        inner_boundary.register_try_catch_handler("inner-catch-handler")

        # Simulate error occurring at inner level
        error = ValueError("Inner error")
        inner_boundary.capture_error(error, entity_id="inner-block", entity_type="block")

        # Verify error is intercepted by innermost handler
        assert inner_boundary.is_intercepted_by_handler("inner-catch-handler") is True
        assert inner_boundary.has_error() is True
        assert inner_boundary.is_contained() is True

        # Error does not propagate to outer boundary (handled by inner)
        assert inner_boundary.should_propagate_to_parent() is False

        # If inner doesn't handle, it would propagate
        outer_boundary_unhandled = ErrorIsolationBoundary(level="test", entity_id="outer-test-2")
        inner_boundary_unhandled = ErrorIsolationBoundary(
            level="block", entity_id="inner-block-2", parent=outer_boundary_unhandled
        )
        # No handler registered - error should propagate
        critical_error = MemoryError("Critical")
        inner_boundary_unhandled.capture_error(
            critical_error, entity_id="inner-block-2", entity_type="block", is_critical=True
        )
        assert inner_boundary_unhandled.should_propagate_to_parent() is True
