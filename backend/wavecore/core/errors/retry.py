"""
Retry mechanism implementation for configurable retry logic (REQ-3.2.2.7 and REQ-3.2.2.8).

Provides automatic failure recovery through repeated execution attempts with
controlled timing and backoff strategies, including conditional retry based on
error matching criteria.
"""

import asyncio
import re
import time
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from wavecore.core.errors.error_handling import ErrorClassifier
from wavecore.models.enums import ExecutionState
from wavecore.plugins._user_patterns import compile_user_pattern

# Error metadata for custom retry classification
_ERROR_RETRY_METADATA: dict[int, bool] = {}


@dataclass
class RetryConfig:
    """Configuration for retry behavior.

    Defines retry parameters including maximum attempts, delay timing,
    and backoff strategy.
    """

    max_attempts: int = 0  # No retry by default
    initial_delay: float = 1.0
    backoff_strategy: str = "exponential"
    max_delay: float | None = None
    growth_factor: float = 2.0

    def __post_init__(self) -> None:
        """Validate retry configuration parameters."""
        if self.max_attempts < 0:
            raise ValueError("Max attempts must be >= 0")

        if self.initial_delay <= 0:
            raise ValueError("Initial delay must be > 0")

        if self.backoff_strategy not in ("constant", "linear", "exponential"):
            raise ValueError("Backoff strategy must be one of: constant, linear, exponential")

        if self.max_delay is not None and self.max_delay <= 0:
            raise ValueError("Max delay must be > 0 or None")

        if self.max_delay is not None and self.max_delay < self.initial_delay:
            raise ValueError("Max delay must be >= initial delay")

        if self.growth_factor <= 1.0:
            raise ValueError("Growth factor must be > 1")


def calculate_delay(config: RetryConfig, attempt: int) -> float:
    """Calculate delay for a retry attempt based on backoff strategy.

    Args:
        config: Retry configuration
        attempt: Current attempt number (1-indexed)

    Returns:
        Delay in seconds before the retry attempt
    """
    if config.backoff_strategy == "constant":
        delay = config.initial_delay
    elif config.backoff_strategy == "linear":
        delay = config.initial_delay * attempt
    else:  # exponential (validated in RetryConfig)
        delay = config.initial_delay * (config.growth_factor ** (attempt - 1))

    # Apply max delay cap if configured
    if config.max_delay is not None:
        delay = min(delay, config.max_delay)

    return delay


def classify_error_for_retry(error: Exception) -> bool:
    """Classify error as retryable or non-retryable.

    Args:
        error: Exception to classify

    Returns:
        True if error is retryable, False otherwise
    """
    # Check for custom classification
    error_id = id(error)
    if error_id in _ERROR_RETRY_METADATA:
        return _ERROR_RETRY_METADATA[error_id]

    # Use error classifier for standard classification
    classifier = ErrorClassifier()
    category = classifier.classify(error)
    return category.is_retryable


def mark_error_retryable(error: Exception, retryable: bool) -> None:
    """Mark a custom error as retryable or non-retryable.

    Args:
        error: Exception to mark
        retryable: Whether the error should be retryable
    """
    error_id = id(error)
    _ERROR_RETRY_METADATA[error_id] = retryable


@dataclass
class RetryContext:
    """Context information for retry execution.

    Provides access to retry state during execution for adaptive behavior.
    """

    current_attempt: int
    max_attempts: int


class ErrorCondition:
    """Error condition for selective retry behavior (REQ-3.2.2.8).

    Matches errors based on various criteria including exception type,
    message patterns, error codes, and custom attributes. Supports logical
    operators (AND, OR, NOT) for complex condition composition.
    """

    def __init__(
        self,
        message_exact: str | None = None,
        message_pattern: str | None = None,
        exception_type: type[Exception] | None = None,
        include_subclasses: bool = False,
        error_code: int | None = None,
        error_code_range: tuple[int, int] | None = None,
        custom_attributes: dict[str, Any] | None = None,
        operator: str | None = None,
        conditions: list["ErrorCondition"] | None = None,
        condition: "ErrorCondition | None" = None,
    ):
        """Initialize error condition.

        Args:
            message_exact: Exact error message to match (case-sensitive)
            message_pattern: Regex pattern to match against error message
            exception_type: Exception type to match
            include_subclasses: Whether to match subclasses of exception_type
            error_code: Specific error code to match
            error_code_range: Range of error codes to match (inclusive)
            custom_attributes: Custom error attributes to match
            operator: Logical operator (AND, OR, NOT)
            conditions: List of conditions for AND/OR operators
            condition: Single condition for NOT operator
        """
        self.message_exact = message_exact
        self.message_pattern = message_pattern
        self.exception_type = exception_type
        self.include_subclasses = include_subclasses
        self.error_code = error_code
        self.error_code_range = error_code_range
        self.custom_attributes = custom_attributes or {}
        self.operator = operator
        self.conditions = conditions or []
        self.condition = condition

        # Validate configuration
        self._validate()

        # Compile regex pattern if provided (case-insensitive for practical error matching)
        self._compiled_pattern: re.Pattern[str] | None = None
        if self.message_pattern:
            try:
                self._compiled_pattern = compile_user_pattern(self.message_pattern, re.IGNORECASE)
            except ValueError as e:
                raise ValueError(f"Invalid regex pattern: {e}") from e

    def _validate(self) -> None:
        """Validate error condition configuration."""
        if self.operator:
            if self.operator not in ("AND", "OR", "NOT"):
                raise ValueError("Operator must be one of: AND, OR, NOT")

            if self.operator in ("AND", "OR"):
                if not self.conditions:
                    raise ValueError(f"{self.operator} operator requires non-empty conditions list")
            elif self.operator == "NOT":
                if self.condition is None:
                    raise ValueError("NOT operator requires single condition")
                if self.conditions:
                    raise ValueError("NOT operator requires single condition")

    def matches(self, error: Exception) -> bool:
        """Check if error matches this condition.

        Args:
            error: Exception to check

        Returns:
            True if error matches, False otherwise
        """
        # Handle logical operators via dispatch
        if self.operator is not None:
            return self._matches_operator(error)

        # All criteria must match (early return on any mismatch)
        return (
            self._matches_message(error)
            and self._matches_type(error)
            and self._matches_code(error)
            and self._matches_code_range(error)
            and self._matches_custom_attributes(error)
        )

    def _matches_operator(self, error: Exception) -> bool:
        """Evaluate logical operator conditions."""
        if self.operator == "AND":
            return all(cond.matches(error) for cond in self.conditions)
        if self.operator == "OR":
            return any(cond.matches(error) for cond in self.conditions)
        # NOT
        return not self.condition.matches(error) if self.condition else False

    def _matches_message(self, error: Exception) -> bool:
        """Check exact message and pattern match."""
        if self.message_exact is not None and str(error) != self.message_exact:
            return False
        if self.message_pattern is not None:
            if self._compiled_pattern is None:
                return False
            if not self._compiled_pattern.search(str(error)):
                return False
        return True

    def _matches_type(self, error: Exception) -> bool:
        """Check exception type match (with optional subclass support)."""
        if self.exception_type is None:
            return True
        if self.include_subclasses:
            return isinstance(error, self.exception_type)
        return type(error) is self.exception_type

    def _matches_code(self, error: Exception) -> bool:
        """Check exact error code match."""
        if self.error_code is None:
            return True
        error_code = self._get_error_code(error)
        return error_code is not None and error_code == self.error_code

    def _matches_code_range(self, error: Exception) -> bool:
        """Check error code range match."""
        if self.error_code_range is None:
            return True
        error_code = self._get_error_code(error)
        if error_code is None:
            return False
        min_code, max_code = self.error_code_range
        return min_code <= error_code <= max_code

    def _matches_custom_attributes(self, error: Exception) -> bool:
        """Check custom attribute matches."""
        for attr_name, expected_value in self.custom_attributes.items():
            if not hasattr(error, attr_name):
                return False
            if getattr(error, attr_name) != expected_value:
                return False
        return True

    def _get_error_code(self, error: Exception) -> int | None:
        """Extract error code from exception.

        Checks multiple common attribute names used by different libraries.

        Args:
            error: Exception to extract code from

        Returns:
            Error code if found, None otherwise
        """
        # Check common error code attribute names
        for attr_name in ("code", "status_code", "errno", "error_code"):
            if hasattr(error, attr_name):
                code = getattr(error, attr_name)
                if isinstance(code, int):
                    return code
        return None


@dataclass
class RetryAttempt:
    """Record of a single retry attempt."""

    attempt_number: int
    error: Exception | None
    timestamp: datetime
    delay: float | None  # Delay after this attempt (None for last attempt)
    backoff_strategy: str


@dataclass
class RetryHistory:
    """Complete history of retry attempts."""

    total_attempts: int
    outcome: str  # "success" or "exhausted"
    final_error: Exception | None
    attempts: list[RetryAttempt] = field(default_factory=list)
    total_retry_time: float = 0.0
    backoff_strategy: str = "exponential"


class RetryExecutor:
    """Executor for retry logic with configurable backoff strategies.

    Handles retry execution with state management, error classification,
    conditional retry based on error conditions, and diagnostic context recording.
    """

    def __init__(
        self,
        max_attempts: int = 0,
        initial_delay: float = 1.0,
        backoff_strategy: str = "exponential",
        max_delay: float | None = None,
        growth_factor: float = 2.0,
        error_conditions: list[tuple[ErrorCondition, str]] | None = None,
    ):
        """Initialize retry executor.

        Args:
            max_attempts: Maximum number of retry attempts
            initial_delay: Initial delay in seconds
            backoff_strategy: Backoff strategy (constant, linear, exponential)
            max_delay: Maximum delay cap in seconds
            growth_factor: Growth factor for exponential backoff
            error_conditions: List of (ErrorCondition, action) tuples for conditional retry.
                            Action is either "retry" or "fail". Evaluated sequentially
                            with first match determining retry eligibility.
        """
        self.config = RetryConfig(
            max_attempts=max_attempts,
            initial_delay=initial_delay,
            backoff_strategy=backoff_strategy,
            max_delay=max_delay,
            growth_factor=growth_factor,
        )
        self._history = RetryHistory(
            total_attempts=0,
            outcome="pending",
            final_error=None,
            backoff_strategy=backoff_strategy,
        )
        self._state = ExecutionState.PENDING
        self._logger: Callable[[dict[str, Any]], None] | None = None
        self._error_conditions = error_conditions

    def set_logger(self, logger: Callable[[dict[str, Any]], None]) -> None:
        """Set logger for retry events.

        Args:
            logger: Callable that receives log entries
        """
        self._logger = logger

    def _log(self, level: str, message: str, **kwargs: Any) -> None:
        """Log a retry event.

        Args:
            level: Log level (info, warning, error)
            message: Log message
            **kwargs: Additional context
        """
        if self._logger:
            entry = {"level": level, "message": message, **kwargs}
            self._logger(entry)

    def get_current_state(self) -> ExecutionState:
        """Get current execution state.

        Returns:
            Current execution state
        """
        return self._state

    def get_retry_history(self) -> RetryHistory:
        """Get complete retry history.

        Returns:
            Retry history with all attempts and outcomes
        """
        return self._history

    def _evaluate_error_conditions(self, error: Exception) -> bool:
        """Evaluate error conditions to determine retry eligibility.

        Evaluates conditions sequentially with first match determining eligibility.
        Falls back to default classification if no conditions match.

        Args:
            error: Exception to evaluate

        Returns:
            True if error should be retried, False otherwise
        """
        # If no conditions configured or empty list, use default classification
        if not self._error_conditions:
            return classify_error_for_retry(error)

        # Evaluate conditions sequentially
        for condition, action in self._error_conditions:
            if condition.matches(error):
                # First match determines action
                return action == "retry"

        # No match - fall back to default classification
        return classify_error_for_retry(error)

    def to_artifact(self) -> dict[str, Any]:
        """Convert retry history to artifact format.

        Returns:
            Dictionary with retry information for artifacts
        """
        return {
            "retry_info": {
                "total_attempts": self._history.total_attempts,
                "total_retry_time": self._history.total_retry_time,
                "backoff_strategy": self._history.backoff_strategy,
                "outcome": self._history.outcome,
                "attempts": [
                    {
                        "attempt_number": a.attempt_number,
                        "error": str(a.error) if a.error else None,
                        "timestamp": a.timestamp.isoformat(),
                        "delay": a.delay,
                        "backoff_strategy": a.backoff_strategy,
                    }
                    for a in self._history.attempts
                ],
            }
        }

    @staticmethod
    def _detect_param_type(
        action: (
            Callable[[], Coroutine[Any, Any, Any]]
            | Callable[[RetryContext], Coroutine[Any, Any, Any]]
            | Callable[[dict[str, Any]], Coroutine[Any, Any, Any]]
        ),
    ) -> str | None:
        """Detect what parameter type the action callable expects.

        Returns:
            "retry_context", "execution_context", or None for no-arg callables.
        """
        import inspect

        sig = inspect.signature(action)
        if not sig.parameters:
            return None

        first_param = next(iter(sig.parameters.values()))
        annotation = first_param.annotation

        if annotation == inspect.Parameter.empty:
            # No annotation - assume RetryContext for backward compatibility
            return "retry_context"

        if isinstance(annotation, type) and issubclass(annotation, RetryContext):
            return "retry_context"

        if annotation is dict or (
            hasattr(annotation, "__origin__") and annotation.__origin__ is dict
        ):
            return "execution_context"

        return None

    async def _invoke_action[
        T
    ](
        self,
        action: (
            Callable[[], Coroutine[Any, Any, T]]
            | Callable[[RetryContext], Coroutine[Any, Any, T]]
            | Callable[[dict[str, Any]], Coroutine[Any, Any, T]]
        ),
        param_type: str | None,
        retry_context: RetryContext,
    ) -> T:
        """Invoke action with the appropriate parameter based on detected type."""
        if param_type == "retry_context":
            return await action(retry_context)  # type: ignore[arg-type,call-arg]
        if param_type == "execution_context":
            execution_context: dict[str, Any] = {}
            return await action(execution_context)  # type: ignore[arg-type,call-arg]
        return await action()  # type: ignore[call-arg]

    def _record_success(self, attempt: int, start_time: float) -> None:
        """Record a successful attempt in history and update state."""
        self._history.total_attempts = attempt
        self._history.outcome = "success"
        self._history.total_retry_time = time.time() - start_time
        self._history.attempts.append(
            RetryAttempt(
                attempt_number=attempt,
                error=None,
                timestamp=datetime.now(),
                delay=None,
                backoff_strategy=self.config.backoff_strategy,
            )
        )
        self._state = ExecutionState.COMPLETED

    def _record_failure(self, attempt: int, error: Exception, start_time: float) -> None:
        """Record a terminal failure in history and update state."""
        self._history.total_attempts = attempt
        self._history.outcome = "exhausted"
        self._history.final_error = error
        self._history.total_retry_time = time.time() - start_time
        self._state = ExecutionState.FAILED

    def _handle_retry_error(
        self, error: Exception, attempt: int, start_time: float
    ) -> float | None:
        """Handle a retry error. Returns delay if should retry, None if should re-raise."""
        is_last_attempt = attempt == self.config.max_attempts
        delay = None if is_last_attempt else calculate_delay(self.config, attempt)

        self._history.attempts.append(
            RetryAttempt(
                attempt_number=attempt,
                error=error,
                timestamp=datetime.now(),
                delay=delay,
                backoff_strategy=self.config.backoff_strategy,
            )
        )

        if not self._evaluate_error_conditions(error):
            self._log("error", f"Non-retryable error: {error}")
            self._record_failure(attempt, error, start_time)
            return None

        if is_last_attempt:
            self._log("error", f"Retry exhausted after {attempt} attempts: {error}")
            self._record_failure(attempt, error, start_time)
            return None

        self._log(
            "warning",
            f"Retry attempt {attempt} failed: {error}. Retrying after {delay}s...",
        )
        return delay

    async def execute_with_retry[
        T
    ](
        self,
        action: (
            Callable[[], Coroutine[Any, Any, T]]
            | Callable[[RetryContext], Coroutine[Any, Any, T]]
            | Callable[[dict[str, Any]], Coroutine[Any, Any, T]]
        ),
    ) -> T:
        """Execute action with retry logic.

        Args:
            action: Async callable to execute. Can accept RetryContext parameter
                   or execution context dict parameter, or no parameters.

        Returns:
            Result from successful execution

        Raises:
            Exception: Final exception if all retries are exhausted or
                      non-retryable error occurs
        """
        self._state = ExecutionState.RUNNING
        start_time = time.time()
        param_type = self._detect_param_type(action)

        for attempt in range(1, self.config.max_attempts + 1):
            retry_context = RetryContext(
                current_attempt=attempt,
                max_attempts=self.config.max_attempts,
            )

            try:
                result = await self._invoke_action(action, param_type, retry_context)
                self._record_success(attempt, start_time)
                return result

            except asyncio.CancelledError:
                raise

            except Exception as error:
                delay = self._handle_retry_error(error, attempt, start_time)
                if delay is None:
                    raise
                if delay > 0:
                    await asyncio.sleep(delay)

        # Unreachable due to logic above, but satisfies type checker
        raise RuntimeError("Retry logic error: should not reach this point")  # pragma: no cover
