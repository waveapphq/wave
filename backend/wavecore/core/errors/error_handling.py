"""
Error classification for the Try/Catch error object (REQ-4.3.1).
"""

from enum import Enum


class ErrorCategory(Enum):
    """Error category classification for error handling decisions."""

    TRANSIENT = "transient"
    PERMANENT = "permanent"
    CRITICAL = "critical"

    @property
    def is_retryable(self) -> bool:
        """Whether this category of errors can be retried."""
        return self == ErrorCategory.TRANSIENT


class ErrorClassifier:
    """Classifies errors into transient, permanent, or critical categories."""

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
        """The category of an error, by its type and, for a RuntimeError, its message."""
        return self._classify_by_type(error, str(error))

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
