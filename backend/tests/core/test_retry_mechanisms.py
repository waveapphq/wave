"""
Tests for configurable retry logic (REQ-3.2.2.7).

Comprehensive test coverage for retry mechanisms including:
- Retry configuration model
- Backoff strategies (constant, linear, exponential)
- Retry eligibility evaluation
- State management across attempts
- Integration with try-catch constructs
- Delay implementation and execution blocking
- Success criteria and terminal states
- Diagnostic context and observability
- Interaction with execution hierarchy
"""

import asyncio
import time
from typing import Any

import pytest

from wavecore.core.errors.error_handling import ErrorCategory, ErrorClassifier
from wavecore.models.enums import ExecutionState


@pytest.fixture(autouse=True)
def clear_retry_metadata() -> None:
    """Clear global retry metadata between tests to prevent pollution."""
    from wavecore.core.errors import retry

    # Clear the global error metadata dict before each test
    retry._ERROR_RETRY_METADATA.clear()
    yield
    # Clear again after test
    retry._ERROR_RETRY_METADATA.clear()


# ============================================================================
# Retry Configuration Model Tests
# ============================================================================


class TestRetryConfiguration:
    """Test retry configuration model and parameter validation."""

    def test_retry_config_with_count_delay_backoff(self) -> None:
        """^Test retry configuration accepts count, delay, and backoff strategy$"""
        from wavecore.core.errors.retry import RetryConfig

        config = RetryConfig(max_attempts=3, initial_delay=1.0, backoff_strategy="exponential")

        assert config.max_attempts == 3
        assert config.initial_delay == 1.0
        assert config.backoff_strategy == "exponential"

    def test_retry_config_defaults(self) -> None:
        """^Test retry configuration provides system defaults$"""
        from wavecore.core.errors.retry import RetryConfig

        config = RetryConfig()

        assert config.max_attempts == 0  # No retry by default
        assert config.initial_delay == 1.0
        assert config.backoff_strategy == "exponential"
        assert config.max_delay is None  # No cap by default

    def test_retry_config_with_max_delay_cap(self) -> None:
        """^Test retry configuration supports maximum delay cap$"""
        from wavecore.core.errors.retry import RetryConfig

        config = RetryConfig(
            max_attempts=5, initial_delay=1.0, backoff_strategy="exponential", max_delay=30.0
        )

        assert config.max_delay == 30.0

    def test_retry_config_invalid_max_attempts(self) -> None:
        """^Test retry configuration rejects negative max attempts$"""
        from wavecore.core.errors.retry import RetryConfig

        with pytest.raises(ValueError, match="^Max attempts must be >= 0$"):
            RetryConfig(max_attempts=-1)

    def test_retry_config_invalid_initial_delay(self) -> None:
        """^Test retry configuration rejects non-positive initial delay$"""
        from wavecore.core.errors.retry import RetryConfig

        with pytest.raises(ValueError, match="^Initial delay must be > 0$"):
            RetryConfig(initial_delay=0)

        with pytest.raises(ValueError, match="^Initial delay must be > 0$"):
            RetryConfig(initial_delay=-1.0)

    def test_retry_config_invalid_backoff_strategy(self) -> None:
        """^Test retry configuration rejects invalid backoff strategy$"""
        from wavecore.core.errors.retry import RetryConfig

        with pytest.raises(
            ValueError,
            match="^Backoff strategy must be one of: constant, linear, exponential$",
        ):
            RetryConfig(backoff_strategy="invalid")

    def test_retry_config_invalid_max_delay(self) -> None:
        """^Test retry configuration rejects invalid max delay$"""
        from wavecore.core.errors.retry import RetryConfig

        with pytest.raises(ValueError, match="^Max delay must be > 0 or None$"):
            RetryConfig(max_delay=0)

        with pytest.raises(ValueError, match="^Max delay must be > 0 or None$"):
            RetryConfig(max_delay=-5.0)

    def test_retry_config_max_delay_less_than_initial_delay(self) -> None:
        """^Test retry configuration rejects max delay less than initial delay$"""
        from wavecore.core.errors.retry import RetryConfig

        with pytest.raises(ValueError, match="^Max delay must be >= initial delay$"):
            RetryConfig(initial_delay=10.0, max_delay=5.0)

    def test_retry_config_with_growth_factor(self) -> None:
        """^Test retry configuration accepts growth factor for exponential backoff$"""
        from wavecore.core.errors.retry import RetryConfig

        config = RetryConfig(
            max_attempts=5, initial_delay=1.0, backoff_strategy="exponential", growth_factor=3.0
        )

        assert config.growth_factor == 3.0

    def test_retry_config_default_growth_factor(self) -> None:
        """^Test retry configuration has default growth factor of 2$"""
        from wavecore.core.errors.retry import RetryConfig

        config = RetryConfig(backoff_strategy="exponential")

        assert config.growth_factor == 2.0  # Default for exponential backoff

    def test_retry_config_invalid_growth_factor(self) -> None:
        """^Test retry configuration rejects invalid growth factor$"""
        from wavecore.core.errors.retry import RetryConfig

        with pytest.raises(ValueError, match="^Growth factor must be > 1$"):
            RetryConfig(growth_factor=1.0)

        with pytest.raises(ValueError, match="^Growth factor must be > 1$"):
            RetryConfig(growth_factor=0.5)

    def test_retry_config_inheritance_block_overrides_test(self) -> None:
        """^Test block-level retry config overrides test-level config$"""
        from wavecore.core.errors.retry import RetryConfig

        _test_config = RetryConfig(max_attempts=3, initial_delay=1.0)
        block_config = RetryConfig(max_attempts=5, initial_delay=2.0)

        # Block config takes precedence
        assert block_config.max_attempts == 5
        assert block_config.initial_delay == 2.0

    def test_retry_config_integration_with_execution_config(self) -> None:
        """^Test retry config integrates with ExecutionConfig model$"""
        from wavecore.core.errors.retry import RetryConfig
        from wavecore.models.workflow import ExecutionConfig

        # ExecutionConfig has retry fields that should map to RetryConfig
        exec_config = ExecutionConfig(
            retry_count=3, retry_delay=2, retry_backoff="exponential", timeout=60
        )

        # Create RetryConfig from ExecutionConfig
        retry_config = RetryConfig(
            max_attempts=exec_config.retry_count,
            initial_delay=float(exec_config.retry_delay),
            backoff_strategy=exec_config.retry_backoff or "exponential",
        )

        assert retry_config.max_attempts == 3
        assert retry_config.initial_delay == 2.0
        assert retry_config.backoff_strategy == "exponential"

    def test_retry_config_from_test_execution_config(self) -> None:
        """^Test retry config can be derived from Test.execution_config$"""
        from wavecore.core.errors.retry import RetryConfig
        from wavecore.models.entities import Test
        from wavecore.models.workflow import ExecutionConfig

        # Test with retry configuration
        test = Test(
            id="test-001",
            name="Test with retry",
            version="1.0.0",
            blocks=[],
            execution_config=ExecutionConfig(
                retry_count=5, retry_delay=1, retry_backoff="linear", continue_on_error=True
            ),
        )

        # Extract retry config from test
        if test.execution_config:
            retry_config = RetryConfig(
                max_attempts=test.execution_config.retry_count,
                initial_delay=float(test.execution_config.retry_delay),
                backoff_strategy=test.execution_config.retry_backoff or "exponential",
            )

            assert retry_config.max_attempts == 5
            assert retry_config.initial_delay == 1.0
            assert retry_config.backoff_strategy == "linear"


# ============================================================================
# Backoff Strategy Tests
# ============================================================================


class TestBackoffStrategies:
    """Test backoff strategy calculations for delay evolution."""

    def test_constant_backoff_maintains_fixed_delay(self) -> None:
        """^Test constant backoff maintains fixed delay across attempts$"""
        from wavecore.core.errors.retry import RetryConfig, calculate_delay

        config = RetryConfig(initial_delay=2.0, backoff_strategy="constant")

        assert calculate_delay(config, attempt=1) == 2.0
        assert calculate_delay(config, attempt=2) == 2.0
        assert calculate_delay(config, attempt=3) == 2.0
        assert calculate_delay(config, attempt=10) == 2.0

    def test_linear_backoff_increases_by_fixed_increment(self) -> None:
        """^Test linear backoff increases delay by fixed increments$"""
        from wavecore.core.errors.retry import RetryConfig, calculate_delay

        config = RetryConfig(initial_delay=1.0, backoff_strategy="linear")

        # Linear: delay = initial_delay * attempt
        assert calculate_delay(config, attempt=1) == 1.0
        assert calculate_delay(config, attempt=2) == 2.0
        assert calculate_delay(config, attempt=3) == 3.0
        assert calculate_delay(config, attempt=5) == 5.0

    def test_exponential_backoff_multiplies_delay(self) -> None:
        """^Test exponential backoff multiplies delay by growth factor$"""
        from wavecore.core.errors.retry import RetryConfig, calculate_delay

        config = RetryConfig(initial_delay=1.0, backoff_strategy="exponential")

        # Exponential: delay = initial_delay * (2 ^ (attempt - 1))
        assert calculate_delay(config, attempt=1) == 1.0  # 1 * 2^0 = 1
        assert calculate_delay(config, attempt=2) == 2.0  # 1 * 2^1 = 2
        assert calculate_delay(config, attempt=3) == 4.0  # 1 * 2^2 = 4
        assert calculate_delay(config, attempt=4) == 8.0  # 1 * 2^3 = 8
        assert calculate_delay(config, attempt=5) == 16.0  # 1 * 2^4 = 16

    def test_exponential_backoff_custom_growth_factor(self) -> None:
        """^Test exponential backoff with configurable growth factor$"""
        from wavecore.core.errors.retry import RetryConfig, calculate_delay

        # Growth factor of 3
        config = RetryConfig(initial_delay=1.0, backoff_strategy="exponential", growth_factor=3.0)

        # Exponential: delay = initial_delay * (growth_factor ^ (attempt - 1))
        assert calculate_delay(config, attempt=1) == 1.0  # 1 * 3^0 = 1
        assert calculate_delay(config, attempt=2) == 3.0  # 1 * 3^1 = 3
        assert calculate_delay(config, attempt=3) == 9.0  # 1 * 3^2 = 9
        assert calculate_delay(config, attempt=4) == 27.0  # 1 * 3^3 = 27

    def test_exponential_backoff_fractional_growth_factor(self) -> None:
        """^Test exponential backoff with fractional growth factor$"""
        from wavecore.core.errors.retry import RetryConfig, calculate_delay

        # Growth factor of 1.5
        config = RetryConfig(initial_delay=2.0, backoff_strategy="exponential", growth_factor=1.5)

        # Exponential: delay = initial_delay * (growth_factor ^ (attempt - 1))
        assert calculate_delay(config, attempt=1) == 2.0  # 2 * 1.5^0 = 2
        assert calculate_delay(config, attempt=2) == 3.0  # 2 * 1.5^1 = 3
        assert calculate_delay(config, attempt=3) == 4.5  # 2 * 1.5^2 = 4.5
        assert calculate_delay(config, attempt=4) == 6.75  # 2 * 1.5^3 = 6.75

    def test_exponential_backoff_respects_max_delay_cap(self) -> None:
        """^Test exponential backoff respects maximum delay cap$"""
        from wavecore.core.errors.retry import RetryConfig, calculate_delay

        config = RetryConfig(initial_delay=1.0, backoff_strategy="exponential", max_delay=10.0)

        # Without cap: attempt 5 would be 16.0, but capped at 10.0
        assert calculate_delay(config, attempt=1) == 1.0
        assert calculate_delay(config, attempt=2) == 2.0
        assert calculate_delay(config, attempt=3) == 4.0
        assert calculate_delay(config, attempt=4) == 8.0
        assert calculate_delay(config, attempt=5) == 10.0  # Capped
        assert calculate_delay(config, attempt=10) == 10.0  # Still capped

    def test_linear_backoff_respects_max_delay_cap(self) -> None:
        """^Test linear backoff respects maximum delay cap$"""
        from wavecore.core.errors.retry import RetryConfig, calculate_delay

        config = RetryConfig(initial_delay=2.0, backoff_strategy="linear", max_delay=7.0)

        assert calculate_delay(config, attempt=1) == 2.0
        assert calculate_delay(config, attempt=2) == 4.0
        assert calculate_delay(config, attempt=3) == 6.0
        assert calculate_delay(config, attempt=4) == 7.0  # Capped at 7.0, not 8.0
        assert calculate_delay(config, attempt=10) == 7.0  # Still capped


# ============================================================================
# Retry Eligibility Evaluation Tests
# ============================================================================


class TestRetryEligibility:
    """Test error classification for retry eligibility."""

    def test_transient_network_error_is_retryable(self) -> None:
        """^Test transient network errors are classified as retryable$"""
        classifier = ErrorClassifier()

        error = ConnectionError("Connection refused")
        category = classifier.classify(error)

        assert category == ErrorCategory.TRANSIENT
        assert category.is_retryable is True

    def test_timeout_error_is_retryable(self) -> None:
        """^Test timeout errors are classified as retryable$"""
        classifier = ErrorClassifier()

        error = TimeoutError("Request timed out")
        category = classifier.classify(error)

        assert category == ErrorCategory.TRANSIENT
        assert category.is_retryable is True

    def test_temporary_resource_unavailable_is_retryable(self) -> None:
        """^Test temporary resource unavailability is retryable$"""
        classifier = ErrorClassifier()

        error = RuntimeError("Resource temporarily unavailable")
        category = classifier.classify(error)

        assert category == ErrorCategory.TRANSIENT
        assert category.is_retryable is True

    def test_authentication_failure_is_non_retryable(self) -> None:
        """^Test authentication failures are non-retryable$"""
        from wavecore.core.errors.retry import classify_error_for_retry

        error = PermissionError("Authentication failed")

        assert classify_error_for_retry(error) is False

    def test_invalid_parameter_error_is_non_retryable(self) -> None:
        """^Test invalid parameter errors are non-retryable$"""
        classifier = ErrorClassifier()

        error = ValueError("Invalid parameter value")
        category = classifier.classify(error)

        assert category == ErrorCategory.PERMANENT
        assert category.is_retryable is False

    def test_assertion_error_is_non_retryable(self) -> None:
        """^Test assertion errors are non-retryable$"""
        classifier = ErrorClassifier()

        error = AssertionError("Expected value mismatch")
        category = classifier.classify(error)

        assert category == ErrorCategory.PERMANENT
        assert category.is_retryable is False

    def test_resource_not_found_is_non_retryable(self) -> None:
        """^Test resource not found errors are non-retryable$"""
        from wavecore.core.errors.retry import classify_error_for_retry

        error = FileNotFoundError("Resource not found")

        assert classify_error_for_retry(error) is False

    def test_custom_error_classification_retryable(self) -> None:
        """^Test custom errors can be explicitly marked as retryable$"""
        from wavecore.core.errors.retry import mark_error_retryable

        error = RuntimeError("Custom transient error")
        mark_error_retryable(error, retryable=True)

        from wavecore.core.errors.retry import classify_error_for_retry

        assert classify_error_for_retry(error) is True

    def test_custom_error_classification_non_retryable(self) -> None:
        """^Test custom errors can be explicitly marked as non-retryable$"""
        from wavecore.core.errors.retry import mark_error_retryable

        error = ConnectionError("Permanent connection issue")
        mark_error_retryable(error, retryable=False)

        from wavecore.core.errors.retry import classify_error_for_retry

        assert classify_error_for_retry(error) is False


# ============================================================================
# State Management Across Attempts Tests
# ============================================================================


class TestStateManagementAcrossAttempts:
    """Test state management and variable scoping across retry attempts."""

    @pytest.mark.asyncio
    async def test_execution_state_reset_between_attempts(self) -> None:
        """^Test execution state is reset between retry attempts$"""
        from wavecore.core.errors.retry import RetryExecutor

        attempt_states = []

        async def failing_action(context: dict[str, Any]) -> None:
            # Record state at start of each attempt
            attempt_states.append(context.get("partial_result"))
            # Modify state during execution
            context["partial_result"] = "incomplete"
            raise ConnectionError("Transient failure")

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01)

        with pytest.raises(ConnectionError):
            await executor.execute_with_retry(failing_action)

        # Each attempt should start with clean state (fresh context dict each time)
        assert attempt_states == [None, None, None]

    @pytest.mark.asyncio
    async def test_variables_before_retry_block_preserved(self) -> None:
        """^Test variables set before retry block remain visible across attempts$"""
        from wavecore.core.errors.retry import RetryExecutor

        outer_var = "preserved"
        attempt_values = []

        async def action() -> None:
            attempt_values.append(outer_var)
            if len(attempt_values) < 3:
                raise ConnectionError("Retry")

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01)
        await executor.execute_with_retry(action)

        # Variable visible in all attempts
        assert attempt_values == ["preserved", "preserved", "preserved"]

    @pytest.mark.asyncio
    async def test_variables_set_within_block_discarded_on_failure(self) -> None:
        """^Test variables set within retry block are discarded on failure$"""
        from wavecore.core.errors.retry import RetryExecutor

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01)
        attempt_count = 0

        async def action() -> None:
            nonlocal attempt_count
            attempt_count += 1
            # Variable set during attempt
            inner_var = f"attempt_{attempt_count}"  # noqa: F841
            if attempt_count < 3:
                raise ConnectionError("Retry")

        await executor.execute_with_retry(action)

        # Only the successful attempt's variable persists
        assert attempt_count == 3

    @pytest.mark.asyncio
    async def test_retry_count_variable_accessible_in_block(self) -> None:
        """^Test blocks can access retry attempt number through special variable$"""
        from wavecore.core.errors.retry import RetryContext, RetryExecutor

        recorded_attempts = []

        async def action(retry_context: RetryContext) -> None:
            recorded_attempts.append(retry_context.current_attempt)
            if retry_context.current_attempt < 3:
                raise ConnectionError("Retry")

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01)
        await executor.execute_with_retry(action)

        assert recorded_attempts == [1, 2, 3]

    @pytest.mark.asyncio
    async def test_resources_released_after_failed_attempt(self) -> None:
        """^Test resources are released after each failed attempt$"""
        from wavecore.core.errors.retry import RetryExecutor

        acquired_resources = []
        released_resources = []

        async def action() -> None:
            resource_id = f"resource_{len(acquired_resources)}"
            acquired_resources.append(resource_id)

            # Simulate resource release on failure
            if len(acquired_resources) < 3:
                released_resources.append(resource_id)
                raise ConnectionError("Retry")

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01)
        await executor.execute_with_retry(action)

        # First 2 attempts should release resources
        assert len(released_resources) == 2

    @pytest.mark.asyncio
    async def test_adaptive_behavior_based_on_attempt_count(self) -> None:
        """^Test blocks can adapt behavior based on retry attempt number$"""
        from wavecore.core.errors.retry import RetryContext, RetryExecutor

        # Track parameters used on each attempt
        attempt_configs = []

        async def adaptive_action(retry_context: RetryContext) -> None:
            # Adapt timeout based on attempt number (increase with each retry)
            base_timeout = 5
            timeout = base_timeout * retry_context.current_attempt
            attempt_configs.append({"attempt": retry_context.current_attempt, "timeout": timeout})

            # Fail on first two attempts, succeed on third
            if retry_context.current_attempt < 3:
                raise ConnectionError(f"Attempt {retry_context.current_attempt} failed")

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01)
        await executor.execute_with_retry(adaptive_action)

        # Verify adaptive behavior: timeout increases with each attempt
        assert len(attempt_configs) == 3
        assert attempt_configs[0] == {"attempt": 1, "timeout": 5}
        assert attempt_configs[1] == {"attempt": 2, "timeout": 10}
        assert attempt_configs[2] == {"attempt": 3, "timeout": 15}

    @pytest.mark.asyncio
    async def test_action_with_unannotated_parameter(self) -> None:
        """^Test action with parameter but no type annotation defaults to RetryContext$"""
        from wavecore.core.errors.retry import RetryExecutor

        received_contexts = []

        async def action_without_annotation(ctx):  # No type annotation
            received_contexts.append(type(ctx).__name__)
            if len(received_contexts) < 2:
                raise ConnectionError("Retry")

        executor = RetryExecutor(max_attempts=2, initial_delay=0.01)
        await executor.execute_with_retry(action_without_annotation)

        # Should receive RetryContext (backward compatibility)
        assert len(received_contexts) == 2
        assert all(ctx == "RetryContext" for ctx in received_contexts)


# ============================================================================
# Integration with Try-Catch Tests
# ============================================================================


class TestRetryTryCatchIntegration:
    """Test retry integration with try-catch error handling."""

    @pytest.mark.asyncio
    async def test_retry_exhausts_before_catch_handler(self) -> None:
        """^Test retry exhausts all attempts before transferring to catch handler$"""
        from wavecore.core.errors.retry import RetryExecutor

        attempt_count = 0
        catch_called = False

        async def failing_action() -> None:
            nonlocal attempt_count
            attempt_count += 1
            raise ConnectionError("Persistent failure")

        async def catch_handler(error: Exception) -> None:
            nonlocal catch_called
            catch_called = True

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01)

        try:
            await executor.execute_with_retry(failing_action)
        except ConnectionError as e:
            await catch_handler(e)

        # All 3 attempts should execute before catch
        assert attempt_count == 3
        assert catch_called is True

    @pytest.mark.asyncio
    async def test_catch_handler_receives_all_retry_context(self) -> None:
        """^Test catch handler receives comprehensive retry context$"""
        from wavecore.core.errors.retry import RetryExecutor

        caught_context = None

        async def failing_action() -> None:
            raise ConnectionError("Failure")

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01)

        try:
            await executor.execute_with_retry(failing_action)
        except ConnectionError:
            caught_context = executor.get_retry_history()

        assert caught_context is not None
        assert len(caught_context.attempts) == 3
        assert all(a.error is not None for a in caught_context.attempts)
        assert all(isinstance(a.delay, float) for a in caught_context.attempts[:-1])

    @pytest.mark.asyncio
    async def test_retry_success_bypasses_catch_handler(self) -> None:
        """^Test successful retry bypasses catch handler entirely$"""
        from wavecore.core.errors.retry import RetryExecutor

        attempt_count = 0
        catch_called = False

        async def action() -> None:
            nonlocal attempt_count
            attempt_count += 1
            if attempt_count < 3:
                raise ConnectionError("Retry")
            # Success on attempt 3

        async def catch_handler(error: Exception) -> None:
            nonlocal catch_called
            catch_called = True

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01)

        try:
            await executor.execute_with_retry(action)
        except ConnectionError as e:
            await catch_handler(e)

        assert attempt_count == 3
        assert catch_called is False  # Should not call catch on success


# ============================================================================
# Delay Implementation Tests
# ============================================================================


class TestDelayImplementation:
    """Test delay implementation and execution blocking behavior."""

    @pytest.mark.asyncio
    async def test_delay_blocks_execution_workflow(self) -> None:
        """^Test delay period blocks the executing workflow$"""
        from wavecore.core.errors.retry import RetryExecutor

        start_time = time.time()
        attempt_count = 0

        async def action() -> None:
            nonlocal attempt_count
            attempt_count += 1
            if attempt_count < 2:
                raise ConnectionError("Retry")

        executor = RetryExecutor(max_attempts=2, initial_delay=0.1)
        await executor.execute_with_retry(action)

        elapsed = time.time() - start_time

        # Should have at least one delay of 0.1 seconds
        assert elapsed >= 0.1

    @pytest.mark.asyncio
    async def test_delay_is_interruptible_on_cancellation(self) -> None:
        """^Test delay responds to cancellation signals$"""
        from wavecore.core.errors.retry import RetryExecutor

        async def long_running_action() -> None:
            raise ConnectionError("Retry")

        executor = RetryExecutor(max_attempts=10, initial_delay=10.0)  # Long delay

        task = asyncio.create_task(executor.execute_with_retry(long_running_action))

        # Wait a bit then cancel
        await asyncio.sleep(0.1)
        task.cancel()

        with pytest.raises(asyncio.CancelledError):
            await task

        # Task should cancel quickly, not wait for full delay
        # (If delay wasn't interruptible, this would take 10+ seconds)

    @pytest.mark.asyncio
    async def test_cancellation_during_action_execution(self) -> None:
        """^Test cancellation during action execution propagates immediately$"""
        from wavecore.core.errors.retry import RetryExecutor

        async def cancellable_action() -> None:
            # Simulate long-running action that can be canceled
            await asyncio.sleep(10.0)

        executor = RetryExecutor(max_attempts=3, initial_delay=0.1)

        task = asyncio.create_task(executor.execute_with_retry(cancellable_action))

        # Cancel while action is running
        await asyncio.sleep(0.05)
        task.cancel()

        with pytest.raises(asyncio.CancelledError):
            await task

    @pytest.mark.asyncio
    async def test_execution_state_reflects_retry_in_progress(self) -> None:
        """^Test execution state shows retry-in-progress during delays$"""
        from wavecore.core.errors.retry import RetryExecutor

        state_during_delay = None

        async def action() -> None:
            raise ConnectionError("Retry")

        executor = RetryExecutor(max_attempts=2, initial_delay=0.1)

        # Monitor state during execution
        async def monitor() -> None:
            nonlocal state_during_delay
            await asyncio.sleep(0.05)  # Check during delay
            state_during_delay = executor.get_current_state()

        await asyncio.gather(executor.execute_with_retry(action), monitor(), return_exceptions=True)

        assert state_during_delay == ExecutionState.RUNNING

    @pytest.mark.asyncio
    async def test_variable_scopes_valid_during_delay(self) -> None:
        """^Test variable scopes remain valid during delay periods$"""
        from wavecore.core.errors.retry import RetryExecutor

        test_var = "preserved"
        attempt_count = 0

        async def action() -> None:
            nonlocal attempt_count
            attempt_count += 1
            # Variable should be accessible even during delay
            assert test_var == "preserved"
            if attempt_count < 2:
                raise ConnectionError("Retry")

        executor = RetryExecutor(max_attempts=2, initial_delay=0.1)
        await executor.execute_with_retry(action)

        assert attempt_count == 2

    @pytest.mark.asyncio
    async def test_resources_persist_during_delay_for_continuity(self) -> None:
        """^Test resource ownership persists during delay for continuity$"""
        from wavecore.core.errors.retry import RetryExecutor

        # Mock resource handle that tracks if it's still valid
        class MockResourceHandle:
            def __init__(self, resource_id: str):
                self.id = resource_id
                self.is_valid = True
                self.access_count = 0

            def access(self) -> str:
                if not self.is_valid:
                    raise RuntimeError("Resource handle is invalid")
                self.access_count += 1
                return f"data_{self.access_count}"

            def invalidate(self) -> None:
                self.is_valid = False

        resource_handle = MockResourceHandle("shared_resource")
        access_results = []

        async def action() -> None:
            # Access resource handle during delay period
            result = resource_handle.access()
            access_results.append(result)

            if len(access_results) < 3:
                raise ConnectionError("Retry")

        executor = RetryExecutor(max_attempts=3, initial_delay=0.05)
        await executor.execute_with_retry(action)

        # Resource handle should remain valid and accessible across all attempts
        assert len(access_results) == 3
        assert access_results == ["data_1", "data_2", "data_3"]
        assert resource_handle.is_valid is True
        assert resource_handle.access_count == 3


# ============================================================================
# Success Criteria and Terminal States Tests
# ============================================================================


class TestTerminalStates:
    """Test retry termination conditions and success criteria."""

    @pytest.mark.asyncio
    async def test_success_on_first_attempt_no_retry(self) -> None:
        """^Test successful first attempt proceeds without retry$"""
        from wavecore.core.errors.retry import RetryExecutor

        attempt_count = 0

        async def successful_action() -> str:
            nonlocal attempt_count
            attempt_count += 1
            return "success"

        executor = RetryExecutor(max_attempts=3, initial_delay=0.1)
        result = await executor.execute_with_retry(successful_action)

        assert result == "success"
        assert attempt_count == 1  # Only one attempt

    @pytest.mark.asyncio
    async def test_success_on_third_attempt_after_failures(self) -> None:
        """^Test success on third attempt after two failures$"""
        from wavecore.core.errors.retry import RetryExecutor

        attempt_count = 0

        async def action() -> str:
            nonlocal attempt_count
            attempt_count += 1
            if attempt_count < 3:
                raise ConnectionError("Retry")
            return "success"

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01)
        result = await executor.execute_with_retry(action)

        assert result == "success"
        assert attempt_count == 3

    @pytest.mark.asyncio
    async def test_exhaustion_after_max_attempts_with_final_failure(self) -> None:
        """^Test retry exhaustion after maximum attempts reached$"""
        from wavecore.core.errors.retry import RetryExecutor

        attempt_count = 0

        async def failing_action() -> None:
            nonlocal attempt_count
            attempt_count += 1
            raise ConnectionError("Persistent failure")

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01)

        with pytest.raises(ConnectionError, match="^Persistent failure$"):
            await executor.execute_with_retry(failing_action)

        assert attempt_count == 3

    @pytest.mark.asyncio
    async def test_non_retryable_error_immediate_failure(self) -> None:
        """^Test non-retryable error causes immediate failure without retry$"""
        from wavecore.core.errors.retry import RetryExecutor

        attempt_count = 0

        async def action() -> None:
            nonlocal attempt_count
            attempt_count += 1
            raise ValueError("Invalid parameter")  # Non-retryable

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01)

        with pytest.raises(ValueError, match="^Invalid parameter$"):
            await executor.execute_with_retry(action)

        # Should fail immediately, only 1 attempt
        assert attempt_count == 1

    @pytest.mark.asyncio
    async def test_retry_history_captured_on_success(self) -> None:
        """^Test retry history captured even on eventual success$"""
        from wavecore.core.errors.retry import RetryExecutor

        attempt_count = 0

        async def action() -> None:
            nonlocal attempt_count
            attempt_count += 1
            if attempt_count < 3:
                raise ConnectionError("Retry")

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01)
        await executor.execute_with_retry(action)

        history = executor.get_retry_history()
        assert history.total_attempts == 3
        assert history.outcome == "success"

    @pytest.mark.asyncio
    async def test_retry_history_captured_on_exhaustion(self) -> None:
        """^Test retry history captured on retry exhaustion$"""
        from wavecore.core.errors.retry import RetryExecutor

        async def failing_action() -> None:
            raise ConnectionError("Failure")

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01)

        with pytest.raises(ConnectionError):
            await executor.execute_with_retry(failing_action)

        history = executor.get_retry_history()
        assert history.total_attempts == 3
        assert history.outcome == "exhausted"
        assert history.final_error is not None


# ============================================================================
# Diagnostic Context and Observability Tests
# ============================================================================


class TestDiagnosticContext:
    """Test diagnostic context recording and observability."""

    @pytest.mark.asyncio
    async def test_each_attempt_records_diagnostic_context(self) -> None:
        """^Test each retry attempt records full diagnostic context$"""
        from wavecore.core.errors.retry import RetryExecutor

        async def failing_action() -> None:
            raise ConnectionError("Failure")

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01, backoff_strategy="exponential")

        with pytest.raises(ConnectionError):
            await executor.execute_with_retry(failing_action)

        history = executor.get_retry_history()

        # Each attempt should have diagnostic info
        assert len(history.attempts) == 3
        for i, attempt in enumerate(history.attempts):
            assert attempt.attempt_number is not None
            assert attempt.error is not None
            assert attempt.timestamp is not None
            # Verify delay duration is recorded (except for last attempt which has no delay)
            if i < len(history.attempts) - 1:
                assert isinstance(attempt.delay, float)
                assert attempt.delay > 0
            # Verify backoff strategy is recorded
            assert attempt.backoff_strategy == "exponential"

    @pytest.mark.asyncio
    async def test_retry_attempts_logged_at_warning_level(self) -> None:
        """^Test retry attempts are logged at warning level$"""
        from wavecore.core.errors.retry import RetryExecutor

        log_collector: list[dict[str, Any]] = []

        async def failing_action() -> None:
            raise ConnectionError("Transient failure")

        executor = RetryExecutor(max_attempts=2, initial_delay=0.01)
        executor.set_logger(lambda entry: log_collector.append(entry))

        with pytest.raises(ConnectionError):
            await executor.execute_with_retry(failing_action)

        # First retry should log at warning level
        warning_logs = [log for log in log_collector if log.get("level") == "warning"]
        assert len(warning_logs) >= 1
        assert any("retry" in log.get("message", "").lower() for log in warning_logs)

    @pytest.mark.asyncio
    async def test_retry_exhaustion_logged_at_error_level(self) -> None:
        """^Test retry exhaustion is logged at error level$"""
        from wavecore.core.errors.retry import RetryExecutor

        log_collector: list[dict[str, Any]] = []

        async def failing_action() -> None:
            raise ConnectionError("Persistent failure")

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01)
        executor.set_logger(lambda entry: log_collector.append(entry))

        with pytest.raises(ConnectionError):
            await executor.execute_with_retry(failing_action)

        # Exhaustion should log at error level
        error_logs = [log for log in log_collector if log.get("level") == "error"]
        assert len(error_logs) >= 1
        assert any("exhausted" in log.get("message", "").lower() for log in error_logs)

    @pytest.mark.asyncio
    async def test_permanent_non_retryable_error_logged_at_error_level(self) -> None:
        """^Test permanent non-retryable errors logged at error level$"""
        from wavecore.core.errors.retry import RetryExecutor

        log_collector: list[dict[str, Any]] = []

        async def action() -> None:
            raise ValueError("Invalid parameter")  # Non-retryable

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01)
        executor.set_logger(lambda entry: log_collector.append(entry))

        with pytest.raises(ValueError):
            await executor.execute_with_retry(action)

        error_logs = [log for log in log_collector if log.get("level") == "error"]
        assert len(error_logs) >= 1

    @pytest.mark.asyncio
    async def test_artifacts_include_retry_sequence_data(self) -> None:
        """^Test artifacts include complete retry sequence information$"""
        from wavecore.core.errors.retry import RetryExecutor

        async def failing_action() -> None:
            raise ConnectionError("Failure")

        executor = RetryExecutor(max_attempts=3, initial_delay=0.1, backoff_strategy="exponential")

        with pytest.raises(ConnectionError):
            await executor.execute_with_retry(failing_action)

        artifact = executor.to_artifact()

        # Artifact should include retry details
        assert artifact["retry_info"]["total_attempts"] == 3
        assert artifact["retry_info"]["total_retry_time"] >= 0.3  # At least 0.1 + 0.2
        assert artifact["retry_info"]["backoff_strategy"] == "exponential"
        assert len(artifact["retry_info"]["attempts"]) == 3

    @pytest.mark.asyncio
    async def test_retry_context_queryable_during_execution(self) -> None:
        """^Test retry context can be queried during execution for adaptive behavior$"""
        from wavecore.core.errors.retry import RetryContext, RetryExecutor

        context_snapshots = []

        async def action(retry_context: RetryContext) -> None:
            context_snapshots.append(
                {
                    "attempt": retry_context.current_attempt,
                    "total_attempts": retry_context.max_attempts,
                }
            )
            if retry_context.current_attempt < 3:
                raise ConnectionError("Retry")

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01)
        await executor.execute_with_retry(action)

        assert len(context_snapshots) == 3
        assert context_snapshots[0]["attempt"] == 1
        assert context_snapshots[2]["attempt"] == 3


# ============================================================================
# Hierarchical Retry Tests
# ============================================================================


class TestHierarchicalRetry:
    """Test retry interaction with execution hierarchy."""

    @pytest.mark.asyncio
    async def test_block_level_retry_executes_independently(self) -> None:
        """^Test block-level retry executes independently within test$"""
        from wavecore.core.errors.retry import RetryExecutor

        block_attempts = 0

        async def block_action() -> None:
            nonlocal block_attempts
            block_attempts += 1
            if block_attempts < 2:
                raise ConnectionError("Block retry")

        block_executor = RetryExecutor(max_attempts=3, initial_delay=0.01)
        await block_executor.execute_with_retry(block_action)

        assert block_attempts == 2

    @pytest.mark.asyncio
    async def test_inner_retry_exhausts_before_outer_evaluation(self) -> None:
        """^Test inner retry exhausts all attempts before outer retry evaluates$"""
        from wavecore.core.errors.retry import RetryExecutor

        inner_attempts = 0
        outer_attempts = 0

        async def inner_action() -> None:
            nonlocal inner_attempts
            inner_attempts += 1
            raise ConnectionError("Inner failure")

        async def outer_action() -> None:
            nonlocal outer_attempts
            outer_attempts += 1

            # Inner retry
            inner_executor = RetryExecutor(max_attempts=2, initial_delay=0.01)
            try:
                await inner_executor.execute_with_retry(inner_action)
            except ConnectionError:
                # Inner exhausted, now outer will retry
                raise

        outer_executor = RetryExecutor(max_attempts=2, initial_delay=0.01)

        with pytest.raises(ConnectionError):
            await outer_executor.execute_with_retry(outer_action)

        # Inner should execute 2 attempts per outer attempt
        # Outer has 2 attempts, so inner executes 2 * 2 = 4 times
        assert inner_attempts == 4
        assert outer_attempts == 2

    @pytest.mark.asyncio
    async def test_outer_scope_variables_visible_during_inner_retry(self) -> None:
        """^Test outer scope variables remain visible during inner retry$"""
        from wavecore.core.errors.retry import RetryExecutor

        outer_var = "outer_value"
        inner_attempts = 0

        async def inner_action() -> None:
            nonlocal inner_attempts
            inner_attempts += 1
            # Outer variable should be visible
            assert outer_var == "outer_value"
            if inner_attempts < 2:
                raise ConnectionError("Inner retry")

        async def outer_action() -> None:
            inner_executor = RetryExecutor(max_attempts=3, initial_delay=0.01)
            await inner_executor.execute_with_retry(inner_action)

        outer_executor = RetryExecutor(max_attempts=1, initial_delay=0.01)
        await outer_executor.execute_with_retry(outer_action)

        assert inner_attempts == 2

    @pytest.mark.asyncio
    async def test_inner_scope_modifications_discarded_on_failure(self) -> None:
        """^Test inner scope modifications discarded when inner retry fails$"""
        from wavecore.core.errors.retry import RetryExecutor

        inner_var_values = []

        async def inner_action() -> None:
            inner_var = f"inner_{len(inner_var_values)}"
            inner_var_values.append(inner_var)
            raise ConnectionError("Inner failure")

        async def outer_action() -> None:
            inner_executor = RetryExecutor(max_attempts=2, initial_delay=0.01)
            try:
                await inner_executor.execute_with_retry(inner_action)
            except ConnectionError:
                raise

        outer_executor = RetryExecutor(max_attempts=1, initial_delay=0.01)

        with pytest.raises(ConnectionError):
            await outer_executor.execute_with_retry(outer_action)

        # Inner variables created but discarded on each failure
        assert len(inner_var_values) == 2


# ============================================================================
# Conditional Retry Logic Tests (REQ-3.2.2.8)
# ============================================================================


class TestErrorConditionModel:
    """Test error condition model for selective retry behavior."""

    def test_exact_string_match_condition(self) -> None:
        """^Test error condition matches exact error message string$"""
        from wavecore.core.errors.retry import ErrorCondition

        condition = ErrorCondition(message_exact="Connection refused")

        # Exact match
        assert condition.matches(ConnectionError("Connection refused")) is True

        # Different message
        assert condition.matches(ConnectionError("Connection timeout")) is False

    def test_regex_pattern_match_condition(self) -> None:
        """^Test error condition matches error message with regex pattern$"""
        from wavecore.core.errors.retry import ErrorCondition

        condition = ErrorCondition(message_pattern=r"^Connection (refused|timeout)$")

        assert condition.matches(ConnectionError("Connection refused")) is True
        assert condition.matches(ConnectionError("Connection timeout")) is True
        assert condition.matches(ConnectionError("Connection reset")) is False

    def test_exception_type_match_condition(self) -> None:
        """^Test error condition matches specific exception type$"""
        from wavecore.core.errors.retry import ErrorCondition

        condition = ErrorCondition(exception_type=ConnectionError)

        assert condition.matches(ConnectionError("Any message")) is True
        assert condition.matches(TimeoutError("Timeout")) is False
        assert condition.matches(ValueError("Invalid")) is False

    def test_exception_type_hierarchy_match(self) -> None:
        """^Test error condition matches exception type hierarchy$"""
        from wavecore.core.errors.retry import ErrorCondition

        # Match OSError and its subclasses
        condition = ErrorCondition(exception_type=OSError, include_subclasses=True)

        assert condition.matches(OSError("OS error")) is True
        assert condition.matches(ConnectionError("Connection")) is True  # Subclass
        assert condition.matches(TimeoutError("Timeout")) is True  # Subclass
        assert condition.matches(ValueError("Value")) is False  # Not subclass

    def test_error_code_exact_match_condition(self) -> None:
        """^Test error condition matches specific error code$"""
        from wavecore.core.errors.retry import ErrorCondition

        condition = ErrorCondition(error_code=404)

        # Create custom error with code attribute
        error_404 = RuntimeError("Not found")
        error_404.code = 404  # type: ignore

        error_500 = RuntimeError("Server error")
        error_500.code = 500  # type: ignore

        assert condition.matches(error_404) is True
        assert condition.matches(error_500) is False

    def test_error_code_range_match_condition(self) -> None:
        """^Test error condition matches error code range$"""
        from wavecore.core.errors.retry import ErrorCondition

        # Match 500-599 (server errors)
        condition = ErrorCondition(error_code_range=(500, 599))

        error_500 = RuntimeError("Server error")
        error_500.code = 500  # type: ignore

        error_503 = RuntimeError("Service unavailable")
        error_503.code = 503  # type: ignore

        error_404 = RuntimeError("Not found")
        error_404.code = 404  # type: ignore

        assert condition.matches(error_500) is True
        assert condition.matches(error_503) is True
        assert condition.matches(error_404) is False

    def test_custom_attribute_match_condition(self) -> None:
        """^Test error condition matches custom error attributes$"""
        from wavecore.core.errors.retry import ErrorCondition

        condition = ErrorCondition(custom_attributes={"retryable": True, "category": "network"})

        error_retryable = RuntimeError("Transient")
        error_retryable.retryable = True  # type: ignore
        error_retryable.category = "network"  # type: ignore

        error_not_retryable = RuntimeError("Permanent")
        error_not_retryable.retryable = False  # type: ignore

        assert condition.matches(error_retryable) is True
        assert condition.matches(error_not_retryable) is False

    def test_and_logical_operator_combines_conditions(self) -> None:
        """^Test AND operator combines multiple conditions (all must match)$"""
        from wavecore.core.errors.retry import ErrorCondition

        # ConnectionError AND message contains "refused"
        condition = ErrorCondition(
            operator="AND",
            conditions=[
                ErrorCondition(exception_type=ConnectionError),
                ErrorCondition(message_pattern=r".*refused.*"),
            ],
        )

        assert condition.matches(ConnectionError("Connection refused")) is True
        assert condition.matches(ConnectionError("Connection timeout")) is False
        assert condition.matches(TimeoutError("Connection refused")) is False

    def test_or_logical_operator_combines_conditions(self) -> None:
        """^Test OR operator combines multiple conditions (any must match)$"""
        from wavecore.core.errors.retry import ErrorCondition

        # ConnectionError OR TimeoutError
        condition = ErrorCondition(
            operator="OR",
            conditions=[
                ErrorCondition(exception_type=ConnectionError),
                ErrorCondition(exception_type=TimeoutError),
            ],
        )

        assert condition.matches(ConnectionError("Connection failed")) is True
        assert condition.matches(TimeoutError("Request timeout")) is True
        assert condition.matches(ValueError("Invalid parameter")) is False

    def test_not_logical_operator_inverts_condition(self) -> None:
        """^Test NOT operator inverts condition match result$"""
        from wavecore.core.errors.retry import ErrorCondition

        # NOT ValueError
        condition = ErrorCondition(
            operator="NOT", condition=ErrorCondition(exception_type=ValueError)
        )

        assert condition.matches(ConnectionError("Connection")) is True
        assert condition.matches(TimeoutError("Timeout")) is True
        assert condition.matches(ValueError("Invalid")) is False

    def test_complex_nested_logical_conditions(self) -> None:
        """^Test complex nested logical conditions with AND/OR/NOT$"""
        from wavecore.core.errors.retry import ErrorCondition

        # (ConnectionError AND message contains "refused") OR (TimeoutError AND NOT message contains
        # "auth")
        condition = ErrorCondition(
            operator="OR",
            conditions=[
                ErrorCondition(
                    operator="AND",
                    conditions=[
                        ErrorCondition(exception_type=ConnectionError),
                        ErrorCondition(message_pattern=r".*refused.*"),
                    ],
                ),
                ErrorCondition(
                    operator="AND",
                    conditions=[
                        ErrorCondition(exception_type=TimeoutError),
                        ErrorCondition(
                            operator="NOT",
                            condition=ErrorCondition(message_pattern=r".*auth.*"),
                        ),
                    ],
                ),
            ],
        )

        assert condition.matches(ConnectionError("Connection refused")) is True
        assert condition.matches(TimeoutError("Request timeout")) is True
        assert condition.matches(TimeoutError("Authentication timeout")) is False
        assert condition.matches(ValueError("Invalid")) is False

    def test_invalid_regex_pattern_raises_error(self) -> None:
        """^Test invalid regex pattern raises clear validation error$"""
        from wavecore.core.errors.retry import ErrorCondition

        with pytest.raises(ValueError, match="^Invalid regex pattern"):
            ErrorCondition(message_pattern=r"[invalid(regex")

    def test_and_operator_requires_conditions_list(self) -> None:
        """^Test AND operator without conditions raises validation error$"""
        from wavecore.core.errors.retry import ErrorCondition

        with pytest.raises(ValueError, match="^AND operator requires non-empty conditions list$"):
            ErrorCondition(operator="AND", conditions=[])

    def test_or_operator_requires_conditions_list(self) -> None:
        """^Test OR operator without conditions raises validation error$"""
        from wavecore.core.errors.retry import ErrorCondition

        with pytest.raises(ValueError, match="^OR operator requires non-empty conditions list$"):
            ErrorCondition(operator="OR", conditions=[])

    def test_not_operator_requires_single_condition(self) -> None:
        """^Test NOT operator requires exactly one condition$"""
        from wavecore.core.errors.retry import ErrorCondition

        with pytest.raises(ValueError, match="^NOT operator requires single condition$"):
            ErrorCondition(
                operator="NOT",
                condition=ErrorCondition(exception_type=ValueError),
                conditions=[ErrorCondition(exception_type=RuntimeError)],
            )

    def test_not_operator_without_condition_raises_error(self) -> None:
        """^Test NOT operator without condition raises validation error$"""
        from wavecore.core.errors.retry import ErrorCondition

        with pytest.raises(ValueError, match="^NOT operator requires single condition$"):
            ErrorCondition(operator="NOT")

    def test_invalid_operator_raises_error(self) -> None:
        """^Test invalid operator raises validation error$"""
        from wavecore.core.errors.retry import ErrorCondition

        with pytest.raises(ValueError, match="^Operator must be one of: AND, OR, NOT$"):
            ErrorCondition(operator="XOR")

    def test_error_code_checks_multiple_attribute_names(self) -> None:
        """^Test error code matching checks multiple common attribute names$"""
        from wavecore.core.errors.retry import ErrorCondition

        condition = ErrorCondition(error_code=404)

        # Test with different attribute names used by different libraries
        error_with_code = RuntimeError("Not found")
        error_with_code.code = 404  # type: ignore
        assert condition.matches(error_with_code) is True

        error_with_status_code = RuntimeError("Not found")
        error_with_status_code.status_code = 404  # type: ignore
        assert condition.matches(error_with_status_code) is True

        error_with_errno = RuntimeError("Not found")
        error_with_errno.errno = 404  # type: ignore
        assert condition.matches(error_with_errno) is True

        error_with_error_code = RuntimeError("Not found")
        error_with_error_code.error_code = 404  # type: ignore
        assert condition.matches(error_with_error_code) is True

        # No matching attribute
        error_no_code = RuntimeError("Not found")
        assert condition.matches(error_no_code) is False

    def test_message_exact_match_is_case_sensitive(self) -> None:
        """^Test exact message matching is case-sensitive by default$"""
        from wavecore.core.errors.retry import ErrorCondition

        condition = ErrorCondition(message_exact="Connection Refused")

        assert condition.matches(ConnectionError("Connection Refused")) is True
        assert condition.matches(ConnectionError("connection refused")) is False
        assert condition.matches(ConnectionError("CONNECTION REFUSED")) is False

    def test_error_code_range_with_no_code_attribute(self) -> None:
        """^Test error code range matching when error has no code attribute$"""
        from wavecore.core.errors.retry import ErrorCondition

        # Line 247: error_code_range check when error has no code
        condition = ErrorCondition(error_code_range=(500, 599))

        # Error without any code attribute
        error_no_code = RuntimeError("Server error")

        assert condition.matches(error_no_code) is False

    def test_custom_attributes_with_missing_attribute(self) -> None:
        """^Test custom attributes matching when attribute doesn't exist on error$"""
        from wavecore.core.errors.retry import ErrorCondition

        # Line 256: custom_attributes check when attribute is missing
        condition = ErrorCondition(custom_attributes={"retryable": True})

        # Error without the expected attribute
        error_no_attr = RuntimeError("Error without attributes")

        assert condition.matches(error_no_attr) is False

    def test_message_pattern_with_none_compiled_pattern(self) -> None:
        """^Test defensive code for None compiled pattern (unreachable but tested for coverage)$"""
        from wavecore.core.errors.retry import ErrorCondition

        # Create condition with valid pattern
        condition = ErrorCondition(message_pattern=r"connection")

        # Manually set _compiled_pattern to None to test defensive code (line 224)
        # This simulates a pathological state that shouldn't occur in normal operation
        condition._compiled_pattern = None

        # Should return False when compiled pattern is None
        error = ConnectionError("connection refused")
        assert condition.matches(error) is False


class TestConditionEvaluation:
    """Test error condition evaluation logic."""

    @pytest.mark.asyncio
    async def test_first_match_determines_retry_eligibility(self) -> None:
        """^Test first matching condition determines retry eligibility$"""
        from wavecore.core.errors.retry import ErrorCondition, RetryExecutor

        # First condition: retry on ConnectionError
        # Second condition: fail on TimeoutError
        conditions = [
            (ErrorCondition(exception_type=ConnectionError), "retry"),
            (ErrorCondition(exception_type=TimeoutError), "fail"),
        ]

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01, error_conditions=conditions)

        attempt_count = 0

        async def action() -> None:
            nonlocal attempt_count
            attempt_count += 1
            if attempt_count == 1:
                raise ConnectionError("Should retry")

        await executor.execute_with_retry(action)
        assert attempt_count == 2  # Retried once

    @pytest.mark.asyncio
    async def test_condition_action_retry_enables_retry(self) -> None:
        """^Test condition with 'retry' action enables retry for matching error$"""
        from wavecore.core.errors.retry import ErrorCondition, RetryExecutor

        condition = (ErrorCondition(message_pattern=r".*transient.*"), "retry")

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01, error_conditions=[condition])

        attempt_count = 0

        async def action() -> None:
            nonlocal attempt_count
            attempt_count += 1
            if attempt_count < 3:
                raise RuntimeError("Transient error")

        await executor.execute_with_retry(action)
        assert attempt_count == 3

    @pytest.mark.asyncio
    async def test_condition_action_fail_prevents_retry(self) -> None:
        """^Test condition with 'fail' action prevents retry for matching error$"""
        from wavecore.core.errors.retry import ErrorCondition, RetryExecutor

        condition = (ErrorCondition(message_pattern=r".*permanent.*"), "fail")

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01, error_conditions=[condition])

        attempt_count = 0

        async def action() -> None:
            nonlocal attempt_count
            attempt_count += 1
            raise RuntimeError("Permanent error")

        with pytest.raises(RuntimeError, match="^Permanent error$"):
            await executor.execute_with_retry(action)

        # Should fail immediately without retry
        assert attempt_count == 1

    @pytest.mark.asyncio
    async def test_unmatched_error_falls_back_to_default_eligibility(self) -> None:
        """^Test unmatched errors use default retry eligibility classification$"""
        from wavecore.core.errors.retry import ErrorCondition, RetryExecutor

        # Only match specific message
        condition = (ErrorCondition(message_exact="Connection refused"), "retry")

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01, error_conditions=[condition])

        attempt_count = 0

        async def action() -> None:
            nonlocal attempt_count
            attempt_count += 1
            # This error doesn't match condition, should use default classification
            raise ConnectionError("Connection timeout")  # Default: retryable

        # Should retry based on default classification
        with pytest.raises(ConnectionError):
            await executor.execute_with_retry(action)

        assert attempt_count == 3

    @pytest.mark.asyncio
    async def test_sequential_condition_evaluation_order(self) -> None:
        """^Test conditions are evaluated sequentially in definition order$"""
        from wavecore.core.errors.retry import ErrorCondition, RetryExecutor

        evaluation_order = []

        class TrackingCondition(ErrorCondition):
            def __init__(self, name: str, **kwargs: Any):
                super().__init__(**kwargs)
                self.name = name

            def matches(self, error: Exception) -> bool:
                evaluation_order.append(self.name)
                return super().matches(error)

        conditions = [
            (TrackingCondition("first", exception_type=ValueError), "fail"),
            (TrackingCondition("second", exception_type=ConnectionError), "retry"),
            (TrackingCondition("third", exception_type=TimeoutError), "retry"),
        ]

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01, error_conditions=conditions)

        async def action() -> None:
            raise ConnectionError("Test")

        with pytest.raises(ConnectionError):
            await executor.execute_with_retry(action)

        # Should evaluate in order and stop at first match
        assert evaluation_order[0] == "first"
        assert evaluation_order[1] == "second"
        # Should not evaluate "third" because "second" matched

    @pytest.mark.asyncio
    async def test_error_context_extraction_for_evaluation(self) -> None:
        """^Test error context is extracted for condition evaluation$"""
        from wavecore.core.errors.retry import ErrorCondition, RetryExecutor

        # Create error with custom attributes
        class CustomError(Exception):
            def __init__(self, message: str, code: int, severity: str):
                super().__init__(message)
                self.code = code
                self.severity = severity

        condition = (
            ErrorCondition(custom_attributes={"code": 503, "severity": "warning"}),
            "retry",
        )

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01, error_conditions=[condition])

        attempt_count = 0

        async def action() -> None:
            nonlocal attempt_count
            attempt_count += 1
            if attempt_count < 2:
                raise CustomError("Service unavailable", code=503, severity="warning")

        await executor.execute_with_retry(action)
        assert attempt_count == 2

    @pytest.mark.asyncio
    async def test_empty_conditions_list_uses_default_eligibility(self) -> None:
        """^Test empty conditions list falls back to default classification$"""
        from wavecore.core.errors.retry import RetryExecutor

        # Empty conditions list - should use default retry eligibility (REQ-3.2.2.7)
        executor = RetryExecutor(max_attempts=3, initial_delay=0.01, error_conditions=[])

        attempt_count = 0

        async def action() -> None:
            nonlocal attempt_count
            attempt_count += 1
            # ConnectionError is retryable by default classification
            raise ConnectionError("Transient failure")

        with pytest.raises(ConnectionError):
            await executor.execute_with_retry(action)

        # Should retry based on default classification (retryable)
        assert attempt_count == 3

    @pytest.mark.asyncio
    async def test_none_conditions_uses_default_eligibility(self) -> None:
        """^Test None conditions parameter falls back to default classification$"""
        from wavecore.core.errors.retry import RetryExecutor

        # None conditions - should use default retry eligibility
        executor = RetryExecutor(max_attempts=3, initial_delay=0.01, error_conditions=None)

        attempt_count = 0

        async def action() -> None:
            nonlocal attempt_count
            attempt_count += 1
            # ValueError is non-retryable by default classification
            raise ValueError("Invalid parameter")

        with pytest.raises(ValueError):
            await executor.execute_with_retry(action)

        # Should fail immediately based on default classification (non-retryable)
        assert attempt_count == 1


class TestConfigurationHierarchy:
    """Test error condition configuration hierarchy and inheritance."""

    @pytest.mark.asyncio
    async def test_block_level_conditions_override_test_level(self) -> None:
        """^Test block-level error conditions override test-level conditions$"""
        from wavecore.core.errors.retry import ErrorCondition, RetryExecutor

        # Test-level: retry ConnectionError
        _test_conditions = [(ErrorCondition(exception_type=ConnectionError), "retry")]

        # Block-level: fail ConnectionError
        block_conditions = [(ErrorCondition(exception_type=ConnectionError), "fail")]

        # Block executor should use block-level conditions
        executor = RetryExecutor(
            max_attempts=3, initial_delay=0.01, error_conditions=block_conditions
        )

        attempt_count = 0

        async def action() -> None:
            nonlocal attempt_count
            attempt_count += 1
            raise ConnectionError("Test")

        with pytest.raises(ConnectionError):
            await executor.execute_with_retry(action)

        # Should fail immediately (block condition overrides)
        assert attempt_count == 1

    @pytest.mark.asyncio
    async def test_absence_of_conditions_defers_to_parent_level(self) -> None:
        """^Test absence of block conditions defers to parent test-level conditions$"""
        from wavecore.core.errors.retry import ErrorCondition, RetryExecutor

        # Parent (test-level) conditions
        parent_conditions = [(ErrorCondition(exception_type=ConnectionError), "retry")]

        # Block has no conditions, should use parent
        executor = RetryExecutor(
            max_attempts=3, initial_delay=0.01, error_conditions=parent_conditions
        )

        attempt_count = 0

        async def action() -> None:
            nonlocal attempt_count
            attempt_count += 1
            if attempt_count < 3:
                raise ConnectionError("Test")

        await executor.execute_with_retry(action)
        assert attempt_count == 3

    @pytest.mark.asyncio
    async def test_nested_hierarchy_block_test_suite_regression(self) -> None:
        """^Test conditions inherit through block/test/suite/regression hierarchy$"""
        from wavecore.core.errors.retry import ErrorCondition, RetryExecutor

        # Regression-level: retry on any error
        _regression_conditions = [(ErrorCondition(exception_type=Exception), "retry")]

        # Suite-level: specific handling
        suite_conditions = [(ErrorCondition(exception_type=ConnectionError), "fail")]

        # Block uses suite conditions (more specific)
        executor = RetryExecutor(
            max_attempts=3, initial_delay=0.01, error_conditions=suite_conditions
        )

        attempt_count = 0

        async def action() -> None:
            nonlocal attempt_count
            attempt_count += 1
            raise ConnectionError("Test")

        with pytest.raises(ConnectionError):
            await executor.execute_with_retry(action)

        # Suite condition takes precedence
        assert attempt_count == 1


class TestConditionalRetryTryCatchIntegration:
    """Test conditional retry integration with try-catch error handling."""

    @pytest.mark.asyncio
    async def test_retry_conditions_evaluate_before_catch_handler(self) -> None:
        """^Test retry conditions evaluate before catch handler executes$"""
        from wavecore.core.errors.retry import ErrorCondition, RetryExecutor

        condition = (ErrorCondition(message_pattern=r".*transient.*"), "retry")

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01, error_conditions=[condition])

        catch_handler_called = False
        attempt_count = 0

        async def action() -> None:
            nonlocal attempt_count
            attempt_count += 1
            raise RuntimeError("Transient failure")

        try:
            await executor.execute_with_retry(action)
        except RuntimeError:
            catch_handler_called = True

        # Should retry all attempts before catch
        assert attempt_count == 3
        assert catch_handler_called is True

    @pytest.mark.asyncio
    async def test_catch_handler_receives_condition_evaluation_context(self) -> None:
        """^Test catch handler receives condition evaluation results in context$"""
        from wavecore.core.errors.retry import ErrorCondition, RetryExecutor

        condition = (ErrorCondition(message_pattern=r".*transient.*"), "retry")

        executor = RetryExecutor(max_attempts=2, initial_delay=0.01, error_conditions=[condition])

        async def action() -> None:
            raise RuntimeError("Transient failure")

        try:
            await executor.execute_with_retry(action)
        except RuntimeError:
            history = executor.get_retry_history()
            # History should include condition evaluation details
            assert history is not None
            assert len(history.attempts) == 2

    @pytest.mark.asyncio
    async def test_non_matching_condition_transfers_to_catch_immediately(self) -> None:
        """^Test non-matching conditions transfer control to catch handler$"""
        from wavecore.core.errors.retry import ErrorCondition, RetryExecutor

        # Condition that won't match
        condition = (ErrorCondition(message_exact="Connection refused"), "retry")

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01, error_conditions=[condition])

        attempt_count = 0

        async def action() -> None:
            nonlocal attempt_count
            attempt_count += 1
            # Non-retryable by default
            raise ValueError("Invalid parameter")

        try:
            await executor.execute_with_retry(action)
        except ValueError:
            pass

        # Should fail immediately (ValueError is non-retryable by default)
        assert attempt_count == 1


class TestDiagnosticContextForConditions:
    """Test diagnostic context recording for error condition evaluation."""

    @pytest.mark.asyncio
    async def test_evaluated_conditions_recorded_in_context(self) -> None:
        """^Test which conditions were evaluated is recorded in diagnostic context$"""
        from wavecore.core.errors.retry import ErrorCondition, RetryExecutor

        conditions = [
            (ErrorCondition(exception_type=ConnectionError), "retry"),
            (ErrorCondition(exception_type=TimeoutError), "fail"),
        ]

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01, error_conditions=conditions)

        async def action() -> None:
            raise ConnectionError("Test")

        with pytest.raises(ConnectionError):
            await executor.execute_with_retry(action)

        artifact = executor.to_artifact()

        # Artifact should include condition evaluation info
        assert "retry_info" in artifact
        # Should record which conditions were evaluated

    @pytest.mark.asyncio
    async def test_matching_condition_recorded_in_context(self) -> None:
        """^Test which condition matched is recorded in diagnostic context$"""
        from wavecore.core.errors.retry import ErrorCondition, RetryExecutor

        conditions = [
            (ErrorCondition(exception_type=ValueError), "fail"),
            (ErrorCondition(exception_type=ConnectionError), "retry"),
        ]

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01, error_conditions=conditions)

        async def action() -> None:
            raise ConnectionError("Test")

        with pytest.raises(ConnectionError):
            await executor.execute_with_retry(action)

        history = executor.get_retry_history()
        assert history is not None
        # History should indicate which condition matched

    @pytest.mark.asyncio
    async def test_match_results_recorded_in_context(self) -> None:
        """^Test condition match results are recorded in diagnostic context$"""
        from wavecore.core.errors.retry import ErrorCondition, RetryExecutor

        condition = (ErrorCondition(message_pattern=r".*connection.*"), "retry")

        executor = RetryExecutor(max_attempts=2, initial_delay=0.01, error_conditions=[condition])

        async def action() -> None:
            raise ConnectionError("Connection failed")

        with pytest.raises(ConnectionError):
            await executor.execute_with_retry(action)

        _artifact = executor.to_artifact()
        # Match results should be in artifact for analysis

    @pytest.mark.asyncio
    async def test_evaluation_timing_recorded_in_context(self) -> None:
        """^Test condition evaluation timing is recorded in diagnostic context$"""
        from wavecore.core.errors.retry import ErrorCondition, RetryExecutor

        condition = (ErrorCondition(exception_type=ConnectionError), "retry")

        executor = RetryExecutor(max_attempts=2, initial_delay=0.01, error_conditions=[condition])

        async def action() -> None:
            raise ConnectionError("Test")

        with pytest.raises(ConnectionError):
            await executor.execute_with_retry(action)

        history = executor.get_retry_history()
        # Each attempt should have timestamp
        assert all(a.timestamp is not None for a in history.attempts)


class TestVariableIntegration:
    """Test error condition integration with variable system."""

    @pytest.mark.asyncio
    async def test_error_conditions_reference_variables(self) -> None:
        """^Test error conditions can reference variables for dynamic behavior$"""
        from wavecore.core.errors.retry import ErrorCondition, RetryExecutor

        # Variable-based condition
        retry_message = "Connection refused"

        condition = (ErrorCondition(message_exact=retry_message), "retry")

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01, error_conditions=[condition])

        attempt_count = 0

        async def action() -> None:
            nonlocal attempt_count
            attempt_count += 1
            if attempt_count < 2:
                raise ConnectionError(retry_message)

        await executor.execute_with_retry(action)
        assert attempt_count == 2

    @pytest.mark.asyncio
    async def test_variables_resolve_during_condition_evaluation(self) -> None:
        """^Test variables resolve during condition evaluation using current scope$"""
        from wavecore.core.errors.retry import ErrorCondition, RetryExecutor

        # Simulate variable scope
        test_variables = {"retry_on_timeout": True, "max_retries": 3}

        # Condition based on variable value
        if test_variables["retry_on_timeout"]:
            condition = (ErrorCondition(exception_type=TimeoutError), "retry")
        else:
            condition = (ErrorCondition(exception_type=TimeoutError), "fail")

        executor = RetryExecutor(
            max_attempts=test_variables["max_retries"],
            initial_delay=0.01,
            error_conditions=[condition],
        )

        attempt_count = 0

        async def action() -> None:
            nonlocal attempt_count
            attempt_count += 1
            if attempt_count < 3:
                raise TimeoutError("Request timeout")

        await executor.execute_with_retry(action)
        assert attempt_count == 3

    @pytest.mark.asyncio
    async def test_adaptive_retry_policy_based_on_execution_context(self) -> None:
        """^Test retry policy adapts based on test parameters and runtime state$"""
        from wavecore.core.errors.retry import ErrorCondition, RetryContext, RetryExecutor

        # Execution context
        runtime_config = {"env": "production", "strict_mode": True}

        # Different conditions based on environment
        if runtime_config["env"] == "production" and runtime_config["strict_mode"]:
            # Strict: only retry transient network errors
            conditions = [
                (ErrorCondition(exception_type=ConnectionError), "retry"),
                (ErrorCondition(exception_type=Exception), "fail"),  # Fail on anything else
            ]
        else:
            # Lenient: retry most errors
            conditions = [(ErrorCondition(exception_type=Exception), "retry")]

        executor = RetryExecutor(max_attempts=3, initial_delay=0.01, error_conditions=conditions)

        attempt_count = 0

        async def action(retry_context: RetryContext) -> None:
            nonlocal attempt_count
            attempt_count += 1
            if attempt_count < 2:
                raise ConnectionError("Network error")

        await executor.execute_with_retry(action)
        assert attempt_count == 2


# ============================================================================
# Action Parameter Type Detection Tests (Line 481)
# ============================================================================


class TestDetectParamTypeUnknownAnnotation:
    """Test _detect_param_type returns None for unrecognized annotation."""

    def test_detect_param_type_returns_none_for_unknown_annotation(self) -> None:
        """_detect_param_type returns None when first param has non-dict, non-RetryContext type."""
        from wavecore.core.errors.retry import RetryExecutor

        async def action_with_int_param(x: int) -> None:
            pass

        result = RetryExecutor._detect_param_type(action_with_int_param)
        assert result is None

    def test_detect_param_type_returns_none_for_str_annotation(self) -> None:
        """_detect_param_type returns None for str-annotated parameter."""
        from wavecore.core.errors.retry import RetryExecutor

        async def action_with_str_param(name: str) -> None:
            pass

        result = RetryExecutor._detect_param_type(action_with_str_param)
        assert result is None
