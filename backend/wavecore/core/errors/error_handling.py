"""
Graceful Error Handling (REQ-4.3.1).

Provides comprehensive error handling including detection, classification, isolation,
cleanup, context preservation, stability monitoring, and recovery coordination.
"""

import asyncio
import re
import time
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum
from typing import Any

from wavecore.models.enums import ExecutionState

# ============================================================================
# Error Category and Classification
# ============================================================================


class ErrorCategory(Enum):
    """Error category classification for error handling decisions."""

    TRANSIENT = "transient"
    PERMANENT = "permanent"
    CRITICAL = "critical"

    def __init__(self, value: str):
        """Initialize error category."""
        self._value_ = value
        self.error_type = ""
        self.timestamp = datetime.now(UTC)

    @property
    def is_retryable(self) -> bool:
        """Whether this category of errors can be retried."""
        return self == ErrorCategory.TRANSIENT

    @property
    def requires_escalation(self) -> bool:
        """Whether this category requires escalation to system level."""
        return self == ErrorCategory.CRITICAL

    @property
    def description(self) -> str:
        """Human-readable description of this error category."""
        if self == ErrorCategory.TRANSIENT:
            return "Transient network or resource error (retryable)"
        elif self == ErrorCategory.PERMANENT:
            return "Permanent assertion or validation error (non-retryable)"
        else:  # CRITICAL
            return "Critical system error requiring escalation"


@dataclass
class ErrorClassificationRule:
    """Custom error classification rule."""

    pattern: str
    category: ErrorCategory


class ErrorClassifier:
    """Classifies errors into transient, permanent, or critical categories."""

    def __init__(self) -> None:
        """Initialize error classifier with default rules."""
        self._custom_rules: list[ErrorClassificationRule] = []

    def register_rule(self, error_pattern: str, category: ErrorCategory) -> None:
        """Register a custom classification rule."""
        self._custom_rules.append(ErrorClassificationRule(pattern=error_pattern, category=category))

    # Type-based classification lookup (excluding RuntimeError which needs message inspection)
    _TYPE_CLASSIFICATION: dict[type, ErrorCategory] = {
        ConnectionError: ErrorCategory.TRANSIENT,
        TimeoutError: ErrorCategory.TRANSIENT,
        MemoryError: ErrorCategory.CRITICAL,
        AssertionError: ErrorCategory.PERMANENT,
        ValueError: ErrorCategory.PERMANENT,
    }

    # RuntimeError message keywords mapped to categories
    _RUNTIME_TRANSIENT_KEYWORDS = ("temporarily unavailable", "resource temporarily")
    _RUNTIME_CRITICAL_KEYWORDS = ("engine corruption", "node failure", "kubernetes node")

    # The standard name for a refusal by the far side's policy, which no retry clears.
    _POLICY_REFUSAL = "administratively prohibited"

    def classify(self, error: Exception) -> ErrorCategory:
        """
        Classify an error into a category.

        Args:
            error: The exception to classify

        Returns:
            ErrorCategory with metadata attached
        """
        error_str = str(error)
        error_type = type(error).__name__

        # Check custom rules first
        custom = self._classify_by_custom_rules(error_str, error_type)
        if custom is not None:
            return custom

        # Built-in classification
        category = self._classify_by_type(error, error_str)

        # Set metadata
        category.error_type = error_type
        category.timestamp = datetime.now(UTC)
        return category

    def _classify_by_custom_rules(self, error_str: str, error_type: str) -> ErrorCategory | None:
        """Check custom rules and return category if matched, None otherwise."""
        for rule in self._custom_rules:
            if re.search(rule.pattern, error_str):
                category = rule.category
                category.error_type = error_type
                category.timestamp = datetime.now(UTC)
                return category
        return None

    def _classify_by_type(self, error: Exception, error_str: str) -> ErrorCategory:
        """Classify error by its type, reading the message of a ConnectionError or RuntimeError."""
        if isinstance(error, ConnectionError) and self._POLICY_REFUSAL in error_str.lower():
            return ErrorCategory.PERMANENT

        # Check direct type matches
        for error_class, category in self._TYPE_CLASSIFICATION.items():
            if isinstance(error, error_class):
                return category

        # RuntimeError needs message-based classification
        if isinstance(error, RuntimeError):
            return self._classify_runtime_error(error_str)

        # Default to permanent for unknown errors
        return ErrorCategory.PERMANENT

    def _classify_runtime_error(self, error_str: str) -> ErrorCategory:
        """Classify RuntimeError based on message keywords."""
        error_msg_lower = error_str.lower()

        if any(kw in error_msg_lower for kw in self._RUNTIME_TRANSIENT_KEYWORDS):
            return ErrorCategory.TRANSIENT

        if any(kw in error_msg_lower for kw in self._RUNTIME_CRITICAL_KEYWORDS):
            return ErrorCategory.CRITICAL

        return ErrorCategory.PERMANENT


# ============================================================================
# Error Context Preservation
# ============================================================================


@dataclass
class OriginInfo:
    """Error origin information."""

    entity_type: str
    entity_id: str
    entity_version: str = ""
    hierarchy_path: list[str] = field(default_factory=list)


@dataclass
class ExecutionStateInfo:
    """Execution state information."""

    variables: dict[str, Any] = field(default_factory=dict)
    partial_results: dict[str, Any] = field(default_factory=dict)
    current_state: ExecutionState | None = None


@dataclass
class ErrorChainNode:
    """Node in error causality chain."""

    error: Exception
    error_type: str
    timestamp: datetime
    caused_by: "ErrorChainNode | None" = None


@dataclass
class EnvironmentInfo:
    """Environmental context information."""

    resources: dict[str, Any] = field(default_factory=dict)
    infrastructure: dict[str, Any] = field(default_factory=dict)


class ErrorContext:
    """Comprehensive error context preservation."""

    def __init__(self) -> None:
        """Initialize error context."""
        self.origin: OriginInfo | None = None
        self.execution_state: ExecutionStateInfo = ExecutionStateInfo()
        self._error_chain: list[ErrorChainNode] = []
        self.environment: EnvironmentInfo = EnvironmentInfo()
        self.user_defined: dict[str, Any] = {}
        self.parameters: dict[str, Any] = {}
        self.metadata: dict[str, Any] = {}
        self._logger: Callable[[dict[str, Any]], None] | None = None

    @property
    def retry_attempt(self) -> int | None:
        """Get retry attempt number from metadata."""
        return self.metadata.get("retry_attempt")

    def capture_origin(
        self,
        entity_type: str,
        entity_id: str,
        entity_version: str = "",
        hierarchy_path: list[str] | None = None,
    ) -> None:
        """Capture error origin location."""
        self.origin = OriginInfo(
            entity_type=entity_type,
            entity_id=entity_id,
            entity_version=entity_version,
            hierarchy_path=hierarchy_path or [],
        )

    def capture_execution_state(
        self,
        variables: dict[str, Any] | None = None,
        partial_results: dict[str, Any] | None = None,
        current_state: ExecutionState | None = None,
    ) -> None:
        """Capture execution state with variables and partial results."""
        if variables is not None:
            self.execution_state.variables = variables
        if partial_results is not None:
            self.execution_state.partial_results = partial_results
        if current_state is not None:
            self.execution_state.current_state = current_state

    def add_to_chain(self, error: Exception, caused_by: Exception | None = None) -> None:
        """Add error to causality chain."""
        caused_by_node = None
        if caused_by:
            # Find the node for the causing error
            for node in self._error_chain:
                if node.error == caused_by:
                    caused_by_node = node
                    break

        node = ErrorChainNode(
            error=error,
            error_type=type(error).__name__,
            timestamp=datetime.now(UTC),
            caused_by=caused_by_node,
        )
        self._error_chain.append(node)

    def get_error_chain(self) -> list[ErrorChainNode]:
        """Get the error causality chain."""
        return self._error_chain

    def capture_environment(
        self,
        resources: dict[str, Any] | None = None,
        infrastructure: dict[str, Any] | None = None,
    ) -> None:
        """Capture environmental context."""
        if resources is not None:
            self.environment.resources = resources
        if infrastructure is not None:
            self.environment.infrastructure = infrastructure

    def capture_user_defined(
        self,
        custom_variables: dict[str, Any] | None = None,
        parameters: dict[str, Any] | None = None,
    ) -> None:
        """Capture user-defined context from variables and parameters."""
        if custom_variables is not None:
            self.user_defined.update(custom_variables)
        if parameters is not None:
            self.parameters.update(parameters)

    def add_metadata(self, metadata: dict[str, Any]) -> None:
        """Add metadata to the context."""
        self.metadata.update(metadata)

    def to_artifact(self) -> dict[str, Any]:
        """Convert context to artifact representation."""
        return {
            "origin": {
                "entity_type": self.origin.entity_type if self.origin else None,
                "entity_id": self.origin.entity_id if self.origin else None,
                "entity_version": self.origin.entity_version if self.origin else None,
                "hierarchy_path": self.origin.hierarchy_path if self.origin else [],
            },
            "execution_state": {
                "variables": self.execution_state.variables,
                "partial_results": self.execution_state.partial_results,
                "current_state": (
                    self.execution_state.current_state.name
                    if self.execution_state.current_state
                    else None
                ),
            },
            "error_chain": [
                {
                    "error_type": node.error_type,
                    "message": str(node.error),
                    "timestamp": node.timestamp.isoformat(),
                }
                for node in self._error_chain
            ],
            "environment": {
                "resources": self.environment.resources,
                "infrastructure": self.environment.infrastructure,
            },
            "user_defined": self.user_defined,
            "parameters": self.parameters,
            "metadata": self.metadata,
        }

    def get_handler_context(self) -> dict[str, Any]:
        """Get context for error handling constructs."""
        return {
            "origin": {
                "entity_type": self.origin.entity_type if self.origin else None,
                "entity_id": self.origin.entity_id if self.origin else None,
                "entity_version": self.origin.entity_version if self.origin else None,
            },
            "execution_state": {
                "variables": self.execution_state.variables,
                "partial_results": self.execution_state.partial_results,
                "current_state": self.execution_state.current_state,
            },
            "environment": {
                "resources": self.environment.resources,
                "infrastructure": self.environment.infrastructure,
            },
            "user_defined": self.user_defined,
            "parameters": self.parameters,
            "metadata": self.metadata,
        }

    def set_logger(self, logger: Callable[[dict[str, Any]], None]) -> None:
        """Configure logger for error context."""
        self._logger = logger

    def log_error(self, error: Exception) -> None:
        """Log error with full context."""
        if self._logger:
            log_entry = {
                "error_type": type(error).__name__,
                "error_message": str(error),
                "timestamp": datetime.now(UTC).isoformat(),
                "origin": {
                    "entity_type": self.origin.entity_type if self.origin else None,
                    "entity_id": self.origin.entity_id if self.origin else None,
                    "entity_version": (self.origin.entity_version if self.origin else None),
                },
                "execution_state": {
                    "variables": self.execution_state.variables,
                    "partial_results": self.execution_state.partial_results,
                },
                "environment": {
                    "resources": self.environment.resources,
                    "infrastructure": self.environment.infrastructure,
                },
            }
            self._logger(log_entry)


# ============================================================================
# Error Isolation Boundaries
# ============================================================================


class ErrorIsolationBoundary:
    """Manages error isolation boundaries preventing cascading failures."""

    def __init__(
        self,
        level: str,
        entity_id: str = "",
        parent: "ErrorIsolationBoundary | None" = None,
    ):
        """
        Initialize error isolation boundary.

        Args:
            level: Isolation level (plugin, block, test, suite, regression)
            entity_id: Optional entity identifier
            parent: Optional parent boundary
        """
        self.level = level
        self.entity_id = entity_id
        self.parent = parent
        self._error: Exception | None = None
        self._error_entity_id: str | None = None
        self._is_critical: bool = False
        self._state: dict[str, Any] = {}
        self._resources: set[str] = set()
        self._try_catch_handlers: set[str] = set()

    def capture_error(
        self,
        error: Exception,
        entity_id: str,
        entity_type: str,
        is_critical: bool = False,
    ) -> None:
        """Capture an error at this boundary."""
        _ = entity_type
        self._error = error
        self._error_entity_id = entity_id
        self._is_critical = is_critical

    def is_contained(self) -> bool:
        """Check if error is contained at this level."""
        return self._error is not None and not self._is_critical

    def get_propagation_level(self) -> str:
        """Get the level this error should propagate to."""
        if self._is_critical:
            return "system"

        level_hierarchy = ["plugin", "block", "test", "suite", "regression"]
        try:
            current_index = level_hierarchy.index(self.level)
            if current_index < len(level_hierarchy) - 1:
                return level_hierarchy[current_index + 1]
            return "system"
        except ValueError:
            return "system"

    def should_propagate_to_parent(self) -> bool:
        """Check if error should propagate to parent boundary."""
        if self._is_critical:
            return True
        if self._try_catch_handlers:
            return False
        return False

    def is_entity_affected(self, entity_id: str) -> bool:
        """Check if a specific entity is affected by the error."""
        return entity_id == self._error_entity_id

    def register_try_catch_handler(self, handler_id: str) -> None:
        """Register a try-catch handler at this boundary."""
        self._try_catch_handlers.add(handler_id)

    def is_intercepted_by_handler(self, handler_id: str) -> bool:
        """Check if error is intercepted by a specific handler."""
        return handler_id in self._try_catch_handlers

    def set_state(self, state: dict[str, Any]) -> None:
        """Set boundary state."""
        self._state = state.copy()

    def get_state(self) -> dict[str, Any]:
        """Get boundary state."""
        return self._state

    def register_resource(self, resource_id: str) -> None:
        """Register a resource with this boundary."""
        self._resources.add(resource_id)

    def has_resource(self, resource_id: str) -> bool:
        """Check if boundary has a specific resource."""
        return resource_id in self._resources

    def has_error(self) -> bool:
        """Check if this boundary has captured an error."""
        return self._error is not None

    def can_entity_execute(self, entity_id: str) -> bool:
        """Check if an entity can execute despite errors at this boundary."""
        # Entities can execute unless they are the failed entity or critical error occurred
        if self._is_critical:
            return False
        return entity_id != self._error_entity_id

    def is_affected(self) -> bool:
        """Check if this boundary is affected by errors."""
        return self._error is not None


# ============================================================================
# Resource Cleanup Manager
# ============================================================================


@dataclass
class CleanupResource:
    """Resource with cleanup function."""

    resource_id: str
    cleanup_fn: Callable[[], Any]
    level: str = "plugin"


class ResourceCleanupManager:
    """Manages deterministic resource cleanup in reverse acquisition order."""

    def __init__(self, cleanup_timeout: float = 5.0):
        """
        Initialize resource cleanup manager.

        Args:
            cleanup_timeout: Timeout for individual cleanup operations
        """
        self._resources: list[CleanupResource] = []
        self._partial_results: dict[str, Any] = {}
        self._finalize_blocks: list[Callable[[], Any]] = []
        self._error_collector: Callable[[Exception], None] | None = None
        self._cleanup_timeout = cleanup_timeout
        self._error_triggered = False

    def register_resource(
        self,
        resource_id: str,
        cleanup_fn: Callable[[], Any],
        level: str = "plugin",
    ) -> None:
        """Register a resource for cleanup."""
        self._resources.append(
            CleanupResource(resource_id=resource_id, cleanup_fn=cleanup_fn, level=level)
        )

    async def cleanup_all(self) -> None:
        """Execute all cleanup functions in reverse acquisition order."""
        # Execute finalize blocks first
        for finalize_fn in self._finalize_blocks:
            await self._run_finalize_block(finalize_fn)

        # Group resources by level for hierarchical cleanup
        level_order = ["plugin", "block", "test", "suite", "regression"]
        resources_by_level = defaultdict(list)

        for resource in self._resources:
            resources_by_level[resource.level].append(resource)

        # Cleanup in hierarchical order (bottom-up)
        for level in level_order:
            for resource in reversed(resources_by_level[level]):
                await self._cleanup_resource(resource)

    async def _run_finalize_block(self, finalize_fn: Callable[[], Any]) -> None:
        """Execute a single finalize block, collecting any errors."""
        try:
            result = finalize_fn()
            if asyncio.iscoroutine(result):
                await result
        except Exception as e:
            self._collect_error(e)

    async def _cleanup_resource(self, resource: CleanupResource) -> None:
        """Clean up a single resource with timeout, collecting any errors."""
        try:
            result = resource.cleanup_fn()
            if asyncio.iscoroutine(result):
                await asyncio.wait_for(result, timeout=self._cleanup_timeout)
        except TimeoutError:
            self._collect_error(
                TimeoutError(f"Cleanup timeout for resource {resource.resource_id}")
            )
        except Exception as e:
            self._collect_error(e)

    def _collect_error(self, error: Exception) -> None:
        """Forward error to collector if one is configured."""
        if self._error_collector:
            self._error_collector(error)

    def store_partial_result(self, entity_id: str, result: Any) -> None:
        """Store partial result for an entity."""
        self._partial_results[entity_id] = result

    def get_partial_result(self, entity_id: str) -> Any:
        """Get partial result for an entity."""
        return self._partial_results.get(entity_id)

    def register_finalize_block(self, finalize_fn: Callable[[], Any]) -> None:
        """Register a finalize block that executes regardless of errors."""
        self._finalize_blocks.append(finalize_fn)

    def trigger_error(self, error: Exception) -> None:
        """Trigger error state for cleanup."""
        self._error_triggered = True

    def set_error_collector(self, collector: Callable[[Exception], None]) -> None:
        """Set error collector for cleanup failures."""
        self._error_collector = collector


# ============================================================================
# System Stability Monitor
# ============================================================================


class SystemStabilityMonitor:
    """Monitors system stability and triggers protective measures."""

    def __init__(
        self,
        memory_threshold_mb: float = 4096,
        cpu_threshold_percent: float = 90,
        error_rate_threshold: float = 0.3,
        time_window_seconds: float = 10,
        backoff_duration_seconds: float = 5.0,
    ):
        """
        Initialize system stability monitor.

        Args:
            memory_threshold_mb: Memory threshold for throttling
            cpu_threshold_percent: CPU threshold for throttling
            error_rate_threshold: Error rate threshold for backoff
            time_window_seconds: Time window for error rate calculation
            backoff_duration_seconds: Duration of backoff period
        """
        self._memory_threshold_mb = memory_threshold_mb
        self._cpu_threshold_percent = cpu_threshold_percent
        self._error_rate_threshold = error_rate_threshold
        self._time_window_seconds = time_window_seconds
        self._backoff_duration_seconds = backoff_duration_seconds

        self._critical_error_occurred = False
        self._current_memory_mb = 0.0
        self._current_cpu_percent = 0.0
        self._error_timestamps: list[float] = []
        self._health_check_failures: dict[str, str] = {}
        self._corruption_detected = False
        self._backoff_start_time: float | None = None

    def report_error(self, error: Exception, category: ErrorCategory | None = None) -> None:
        """Report an error for stability monitoring."""
        if category == ErrorCategory.CRITICAL:
            self._critical_error_occurred = True

        self._error_timestamps.append(time.time())

        # Prune old errors outside time window
        cutoff_time = time.time() - self._time_window_seconds
        self._error_timestamps = [ts for ts in self._error_timestamps if ts > cutoff_time]

        # Trigger or extend backoff if error rate is high
        recent_errors = [ts for ts in self._error_timestamps if ts > cutoff_time]
        error_rate = len(recent_errors) / self._time_window_seconds
        if error_rate >= self._error_rate_threshold:
            # Set or reset backoff timer for sustained high error rates
            self._backoff_start_time = time.time()

    def can_accept_new_execution(self) -> bool:
        """Check if system can accept new executions."""
        if self._critical_error_occurred:
            return False
        if self._corruption_detected:
            return False
        if self.should_apply_backoff():
            return False
        return True

    def can_perform_cleanup(self) -> bool:
        """Check if system can perform cleanup operations."""
        return True  # Cleanup always allowed

    def update_resource_usage(self, memory_mb: float, cpu_percent: float) -> None:
        """Update current resource usage metrics."""
        self._current_memory_mb = memory_mb
        self._current_cpu_percent = cpu_percent

    def should_throttle_execution(self) -> bool:
        """Check if execution should be throttled due to resource pressure."""
        return (
            self._current_memory_mb > self._memory_threshold_mb
            or self._current_cpu_percent > self._cpu_threshold_percent
        )

    def should_apply_backoff(self) -> bool:
        """Check if backoff should be applied (timer-based, not error-rate based)."""
        # Check if still in backoff period
        if self._backoff_start_time is not None:
            elapsed = time.time() - self._backoff_start_time
            if elapsed < self._backoff_duration_seconds:
                return True
            else:
                # Backoff period expired - clear it and allow recovery
                self._backoff_start_time = None
                return False

        # No active backoff
        return False

    def get_backoff_delay_seconds(self) -> float:
        """Get current backoff delay in seconds."""
        if self.should_apply_backoff():
            return self._backoff_duration_seconds
        return 0.0

    def report_health_check_failure(self, subsystem: str, reason: str) -> None:
        """Report a subsystem health check failure."""
        self._health_check_failures[subsystem] = reason

    def should_initiate_shutdown(self) -> bool:
        """Check if system should initiate shutdown."""
        return len(self._health_check_failures) > 0

    def get_shutdown_mode(self) -> str:
        """Get the shutdown mode (graceful or immediate)."""
        return "graceful"

    def detect_corruption_risk(self, component: str, severity: str) -> None:
        """Detect risk of corruption in a component."""
        _ = component
        if severity in ["high", "critical"]:
            self._corruption_detected = True

    def should_degrade_gracefully(self) -> bool:
        """Check if system should degrade gracefully."""
        return self._corruption_detected


# ============================================================================
# Error Recovery Coordinator
# ============================================================================


@dataclass
class CleanupHandler:
    """Cleanup handler registration."""

    handler_id: str
    handler_fn: Callable[[], Any]


@dataclass
class CleanupFailure:
    """Record of cleanup failure."""

    handler_id: str
    error: Exception


@dataclass
class ErrorRegistration:
    """Registered error with metadata."""

    error: Exception
    source: str
    priority: str
    timestamp: float


class ErrorRecoveryCoordinator:
    """Coordinates error recovery for complex concurrent scenarios."""

    def __init__(self) -> None:
        """Initialize error recovery coordinator."""
        self._errors: list[ErrorRegistration] = []
        self._cleanup_handlers: list[CleanupHandler] = []
        self._cleanup_failures: list[CleanupFailure] = []
        self._current_state: ExecutionState = ExecutionState.PENDING
        self._transition_from_state: ExecutionState | None = None
        self._transition_to_state: ExecutionState | None = None

    def register_error(self, error: Exception, source: str, priority: str = "primary") -> None:
        """Register an error with priority."""
        self._errors.append(
            ErrorRegistration(error=error, source=source, priority=priority, timestamp=time.time())
        )

    def get_dominant_error(self) -> Exception | None:
        """Get the dominant error (primary takes precedence)."""
        primary_errors = [e for e in self._errors if e.priority == "primary"]
        if primary_errors:
            return primary_errors[0].error

        if self._errors:
            return self._errors[0].error

        return None

    def register_cleanup_handler(self, handler_id: str, handler_fn: Callable[[], Any]) -> None:
        """Register a cleanup handler."""
        self._cleanup_handlers.append(CleanupHandler(handler_id=handler_id, handler_fn=handler_fn))

    async def execute_all_cleanups(self) -> None:
        """Execute all cleanup handlers, logging failures but not blocking."""
        for handler in self._cleanup_handlers:
            try:
                result = handler.handler_fn()
                if asyncio.iscoroutine(result):
                    await result
            except Exception as e:
                self._cleanup_failures.append(
                    CleanupFailure(handler_id=handler.handler_id, error=e)
                )

    def get_cleanup_failures(self) -> list[CleanupFailure]:
        """Get list of cleanup failures."""
        return self._cleanup_failures

    async def terminate_parallel_operations(
        self, tasks: list[asyncio.Task[Any]], timeout_seconds: float
    ) -> None:
        """Terminate parallel operations gracefully."""
        _ = timeout_seconds
        # Give tasks a chance to start if they haven't already
        await asyncio.sleep(0)

        # Cancel all tasks
        for task in tasks:
            task.cancel()

        # Yield to event loop to deliver cancellations
        await asyncio.sleep(0)

    async def aggregate_parallel_errors(self, tasks: list[asyncio.Task[Any]]) -> list[Exception]:
        """Aggregate errors from parallel operations."""
        errors = []
        for task in tasks:
            try:
                await task
            except Exception as e:
                errors.append(e)
        return errors

    def begin_transition(self, from_state: ExecutionState, to_state: ExecutionState) -> None:
        """Begin a state transition."""
        self._transition_from_state = from_state
        self._transition_to_state = to_state

    def handle_transition_error(self, error: Exception) -> None:
        """Handle error during state transition."""
        # Rollback to previous state or mark as failed
        if self._transition_from_state:
            self._current_state = self._transition_from_state
        else:
            self._current_state = ExecutionState.FAILED

    def get_current_state(self) -> ExecutionState:
        """Get current execution state."""
        return self._current_state


# ============================================================================
# Graceful Error Handler (Main Orchestrator)
# ============================================================================


class GracefulErrorHandler:
    """Main orchestrator for graceful error handling."""

    def __init__(self) -> None:
        """Initialize graceful error handler."""
        self._handled_errors: set[Exception] = set()
        self._re_raised_errors: set[Exception] = set()
        self._error_contexts: dict[Exception, ErrorContext] = {}
        self._log_collector: Callable[[dict[str, Any]], None] | None = None
        self._error_metrics: dict[str, Any] = {
            "by_category": defaultdict(int),
            "by_type": defaultdict(int),
            "by_origin": defaultdict(int),
        }
        self._diagnostic_collectors: dict[str, Callable[[], dict[str, Any]]] = {}

    def invoke_try_catch(self, error: Exception, context: ErrorContext) -> ErrorContext | None:
        """Invoke try-catch handling with enriched context."""
        _ = error
        return context

    async def handle_in_try_catch(
        self,
        error: Exception,
        context: ErrorContext,
        recovery_action: Callable[[], Any],
        re_raise: bool = False,
    ) -> bool:
        """
        Handle error in try-catch block.

        Args:
            error: The exception to handle
            context: Error context
            recovery_action: Recovery action to execute
            re_raise: Whether to re-raise the error

        Returns:
            True if error was handled successfully, False otherwise
        """
        if re_raise:
            self._re_raised_errors.add(error)
            self._error_contexts[error] = context
            context.add_metadata({"recovery_attempted": True})
            return False

        try:
            result = recovery_action()
            if asyncio.iscoroutine(result):
                await result
            self._handled_errors.add(error)
            self._error_contexts[error] = context
            return True
        except Exception:
            self._error_contexts[error] = context
            context.add_metadata({"recovery_attempted": True})
            return False

    def should_propagate(self, error: Exception) -> bool:
        """Check if error should propagate upward."""
        return error not in self._handled_errors

    def get_propagated_context(self, error: Exception) -> ErrorContext:
        """Get context for a propagated error."""
        if error in self._error_contexts:
            return self._error_contexts[error]
        return ErrorContext()

    async def execute_try_catch_finally(
        self,
        try_action: Callable[[], Any],
        catch_action: Callable[[Exception], Any],
        finally_action: Callable[[], Any],
    ) -> None:
        """Execute try-catch-finally construct."""
        try:
            result = try_action()
            if asyncio.iscoroutine(result):
                await result
        except Exception as e:
            result = catch_action(e)
            if asyncio.iscoroutine(result):
                await result
        finally:
            result = finally_action()
            if asyncio.iscoroutine(result):
                await result

    def should_retry(self, error: Exception) -> bool:
        """Check if error should be retried based on classification."""
        classifier = ErrorClassifier()
        category = classifier.classify(error)
        return category.is_retryable

    async def execute_with_retry(
        self,
        action: Callable[[], Any],
        max_attempts: int,
        context_collector: Callable[[ErrorContext], None] | None = None,
    ) -> None:
        """Execute action with retry logic."""
        for attempt in range(max_attempts):
            try:
                result = action()
                if asyncio.iscoroutine(result):
                    await result
                return
            except Exception:
                if context_collector:
                    ctx = ErrorContext()
                    ctx.metadata["retry_attempt"] = attempt + 1
                    context_collector(ctx)

                if attempt == max_attempts - 1:
                    raise

    def was_re_raised(self, error: Exception) -> bool:
        """Check if an error was re-raised."""
        return error in self._re_raised_errors

    def configure_logger(self, log_collector: Callable[[dict[str, Any]], None]) -> None:
        """Configure logger for error handling."""
        self._log_collector = log_collector

    def log_error(self, error: Exception, context: ErrorContext) -> None:
        """Log error with context."""
        if self._log_collector:
            log_entry = {
                "error_type": type(error).__name__,
                "error_message": str(error),
                "timestamp": datetime.now(UTC).isoformat(),
                "origin": {
                    "entity_type": context.origin.entity_type if context.origin else None,
                    "entity_id": context.origin.entity_id if context.origin else None,
                    "entity_version": (context.origin.entity_version if context.origin else None),
                },
                "execution_state": context.execution_state.__dict__,
            }
            self._log_collector(log_entry)

    def report_error_metric(self, error_type: str, category: ErrorCategory, origin: str) -> None:
        """Report error metric for tracking."""
        self._error_metrics["by_category"][category] += 1
        self._error_metrics["by_type"][error_type] += 1
        self._error_metrics["by_origin"][origin] += 1

    def get_error_metrics(self) -> dict[str, Any]:
        """Get aggregated error metrics."""
        return {
            "by_category": dict(self._error_metrics["by_category"]),
            "by_type": dict(self._error_metrics["by_type"]),
            "by_origin": dict(self._error_metrics["by_origin"]),
        }

    def register_diagnostic_collector(
        self, error_pattern: str, collector: Callable[[], dict[str, Any]]
    ) -> None:
        """Register diagnostic collector for specific error patterns."""
        self._diagnostic_collectors[error_pattern] = collector

    def collect_diagnostics(self, error: Exception) -> dict[str, Any]:
        """Collect diagnostics for an error."""
        error_type = type(error).__name__
        if error_type in self._diagnostic_collectors:
            return self._diagnostic_collectors[error_type]()
        return {}

    def create_error_artifact(self, error: Exception, context: ErrorContext) -> dict[str, Any]:
        """Create error artifact for persistence."""
        return {
            "error": {
                "type": type(error).__name__,
                "message": str(error),
            },
            "context": {
                "environment": {
                    "resources": context.environment.resources,
                    "infrastructure": context.environment.infrastructure,
                }
            },
            "timestamp": datetime.now(UTC).isoformat(),
        }

    def create_emergency_snapshot(
        self, error: Exception, allow_artifact_failure: bool = False
    ) -> dict[str, Any]:
        """Create emergency snapshot for critical errors."""
        _ = allow_artifact_failure
        return {
            "error_type": type(error).__name__,
            "error_message": str(error),
            "timestamp": datetime.now(UTC).isoformat(),
            "is_emergency_snapshot": True,
        }
