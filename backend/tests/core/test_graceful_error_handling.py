"""
Tests for REQ-4.3.1: Graceful Error Handling.

Covers error classification into transient, permanent and critical categories.
"""

from wavecore.core.errors.error_handling import ErrorCategory, ErrorClassifier


class TestErrorClassification:
    """Test error classification into transient, permanent, and critical categories."""

    def test_classify_transient_network_error(self):
        """Test classification of network errors as transient (retryable)."""
        classifier = ErrorClassifier()

        error = ConnectionError("Connection refused")
        category = classifier.classify(error)

        assert category == ErrorCategory.TRANSIENT
        assert category.is_retryable is True

    def test_classify_policy_refusal_as_permanent(self):
        """A connection refused by the host's policy does not clear on retry."""
        classifier = ErrorClassifier()

        error = ConnectionError(
            "SSH tunnel to db:5432 failed: bastion refused to forward (administratively prohibited)"
        )
        category = classifier.classify(error)

        assert category == ErrorCategory.PERMANENT
        assert category.is_retryable is False

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

    def test_classify_permanent_validation_error(self):
        """Test classification of validation errors as permanent (non-retryable)."""
        classifier = ErrorClassifier()

        error = ValueError("Invalid configuration: missing required field 'api_key'")
        category = classifier.classify(error)

        assert category == ErrorCategory.PERMANENT
        assert category.is_retryable is False

    def test_classify_critical_memory_error(self):
        """Test classification of memory errors as critical."""
        classifier = ErrorClassifier()

        error = MemoryError("Cannot allocate memory")
        category = classifier.classify(error)

        assert category == ErrorCategory.CRITICAL
        assert category.is_retryable is False

    def test_classify_critical_engine_failure(self):
        """Test classification of engine failures as critical."""
        classifier = ErrorClassifier()

        error = RuntimeError("Execution engine corruption detected")
        category = classifier.classify(error)

        assert category == ErrorCategory.CRITICAL

    def test_error_category_structure(self):
        """Test that only the transient category is retryable."""
        assert ErrorCategory.TRANSIENT.is_retryable is True
        assert ErrorCategory.PERMANENT.is_retryable is False
        assert ErrorCategory.CRITICAL.is_retryable is False

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

    def test_classify_unknown_error_type(self):
        """Test classification of unknown error types defaults to permanent."""
        classifier = ErrorClassifier()

        class CustomUnknownError(Exception):
            pass

        error = CustomUnknownError("Unknown error type")
        category = classifier.classify(error)

        assert category == ErrorCategory.PERMANENT
        assert category.is_retryable is False

    def test_classify_generic_runtime_error(self):
        """Test classification of generic RuntimeError (not matching any special patterns)."""
        classifier = ErrorClassifier()

        error = RuntimeError("Some generic runtime error")
        category = classifier.classify(error)

        assert category == ErrorCategory.PERMANENT
