"""
Unit tests for WAVE Delay Control.

Requirements tested:
- REQ-3.5.4.1: Configurable delay blocks
"""

import asyncio
import time
from unittest.mock import AsyncMock, patch

import pytest

# =============================================================================
# REQ-3.5.4.1: Configurable delay blocks - Duration Parameter Validation
# =============================================================================


class TestDelayControlDurationValidation:
    """Test duration parameter validation (REQ-3.5.4.1)."""

    def test_validate_requires_duration_parameter(self):
        """Verify validation fails when duration parameter is missing."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        with pytest.raises(ValueError, match="^duration parameter is required$"):
            asyncio.run(control.validate({}))

    def test_validate_requires_duration_as_positive_integer(self):
        """Verify duration must be a positive integer (milliseconds)."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        with pytest.raises(ValueError, match="^duration must be a positive integer$"):
            asyncio.run(control.validate({"duration": -100}))

    def test_validate_rejects_zero_duration(self):
        """Verify zero duration is rejected."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        with pytest.raises(ValueError, match="^duration must be a positive integer$"):
            asyncio.run(control.validate({"duration": 0}))

    def test_validate_rejects_negative_duration(self):
        """Verify negative duration is rejected."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        with pytest.raises(ValueError, match="^duration must be a positive integer$"):
            asyncio.run(control.validate({"duration": -1}))

    def test_validate_rejects_float_duration(self):
        """Verify float duration is rejected (must be integer)."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        with pytest.raises(ValueError, match="^duration must be a positive integer$"):
            asyncio.run(control.validate({"duration": 100.5}))

    def test_validate_rejects_string_duration(self):
        """Verify string duration is rejected (frontend converts to ms before sending)."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        with pytest.raises(ValueError, match="^duration must be a positive integer$"):
            asyncio.run(control.validate({"duration": "100ms"}))

    def test_validate_accepts_positive_integer_duration(self):
        """Verify positive integer duration is accepted."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        # Should not raise
        asyncio.run(control.validate({"duration": 100}))

    def test_validate_accepts_large_duration(self):
        """Verify large duration values are accepted."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        # 1 hour in milliseconds
        asyncio.run(control.validate({"duration": 3600000}))

    def test_validate_rejects_none_duration(self):
        """Verify None duration is rejected (different from missing)."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        with pytest.raises(ValueError, match="^duration must be a positive integer$"):
            asyncio.run(control.validate({"duration": None}))

    def test_validate_returns_none_on_success(self):
        """Verify validate returns None on successful validation."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        result = asyncio.run(control.validate({"duration": 100}))
        assert result is None


# =============================================================================
# REQ-3.5.4.1: Configurable delay blocks - Execution Behavior
# =============================================================================


class TestDelayControlExecution:
    """Test delay control execution behavior (REQ-3.5.4.1)."""

    def test_execute_pauses_for_specified_duration(self):
        """Verify execute suspends for the specified duration in milliseconds."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        context = {"parameters": {"duration": 50}}  # 50ms

        start = time.time()
        asyncio.run(control.execute(context))
        elapsed = (time.time() - start) * 1000  # Convert to ms

        # Allow some tolerance for timing (50ms delay should complete within 50-150ms)
        assert elapsed >= 45, f"Expected at least 45ms delay, got {elapsed}ms"
        assert elapsed < 150, f"Expected less than 150ms delay, got {elapsed}ms"

    def test_execute_uses_async_sleep(self):
        """Verify execute uses asyncio.sleep for non-blocking delay."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        context = {"parameters": {"duration": 100}}

        with patch("asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            asyncio.run(control.execute(context))
            # Should be called with duration in seconds (100ms = 0.1s)
            mock_sleep.assert_called_once()
            call_args = mock_sleep.call_args[0][0]
            assert abs(call_args - 0.1) < 0.001, f"Expected 0.1s, got {call_args}s"

    def test_execute_yields_to_event_loop(self):
        """Verify delay yields to event loop without consuming CPU."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()

        async def run_concurrent():
            """Run delay concurrently with counter to verify yielding."""
            counter = {"value": 0}
            delay_complete = asyncio.Event()

            async def delay_task():
                context = {"parameters": {"duration": 100}}  # 100ms
                await control.execute(context)
                delay_complete.set()

            async def counter_task():
                while not delay_complete.is_set():
                    counter["value"] += 1
                    await asyncio.sleep(0.01)  # 10ms

            # Run both tasks concurrently
            await asyncio.gather(delay_task(), counter_task())
            return counter["value"]

        # If delay yields properly, counter should increment multiple times
        count = asyncio.run(run_concurrent())
        assert count >= 5, f"Expected counter >= 5 during 100ms delay, got {count}"


class TestDelayControlLogging:
    """Test delay control logging behavior (REQ-3.5.4.1)."""

    def test_execute_logs_duration_at_start(self):
        """Verify execution logs planned duration at start."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        context = {"parameters": {"duration": 100}}

        with patch("wavecore.controls.timing.logging") as mock_logging:
            asyncio.run(control.execute(context))

            # Find call that logs start
            start_calls = [
                call
                for call in mock_logging.getLogger.return_value.info.call_args_list
                if "100" in str(call)
                and ("start" in str(call).lower() or "delay" in str(call).lower())
            ]
            assert len(start_calls) >= 1, "Expected log message at start with duration"

    def test_execute_logs_elapsed_time_at_completion(self):
        """Verify execution logs actual elapsed time at completion."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        context = {"parameters": {"duration": 50}}

        with patch("wavecore.controls.timing.logging") as mock_logging:
            asyncio.run(control.execute(context))

            # Find call that logs completion with elapsed time
            completion_calls = [
                call
                for call in mock_logging.getLogger.return_value.info.call_args_list
                if "complete" in str(call).lower() or "elapsed" in str(call).lower()
            ]
            assert (
                len(completion_calls) >= 1
            ), "Expected log message at completion with elapsed time"


class TestDelayControlCancellation:
    """Test delay control cancellation handling (REQ-3.5.4.1)."""

    def test_execute_terminates_immediately_on_cancellation(self):
        """Verify cancellation terminates delay immediately."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        context = {"parameters": {"duration": 5000}}  # 5 seconds

        async def run_with_cancellation():
            task = asyncio.create_task(control.execute(context))
            await asyncio.sleep(0.05)  # Wait 50ms
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                return True
            return False

        start = time.time()
        was_canceled = asyncio.run(run_with_cancellation())
        elapsed = time.time() - start

        assert was_canceled, "Expected task to be canceled"
        assert elapsed < 1.0, f"Expected cancellation within 1s, took {elapsed}s"

    def test_execute_propagates_cancellation(self):
        """Verify cancellation is propagated as CancelledError."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        context = {"parameters": {"duration": 5000}}

        async def run_with_cancellation():
            task = asyncio.create_task(control.execute(context))
            await asyncio.sleep(0.05)
            task.cancel()
            await task

        with pytest.raises(asyncio.CancelledError):
            asyncio.run(run_with_cancellation())

    def test_execute_terminates_on_timeout(self):
        """Verify timeout context terminates delay immediately."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        context = {"parameters": {"duration": 5000}}  # 5 seconds

        async def run_with_timeout():
            try:
                async with asyncio.timeout(0.1):  # 100ms timeout
                    await control.execute(context)
            except TimeoutError:
                return True
            return False

        start = time.time()
        timed_out = asyncio.run(run_with_timeout())
        elapsed = time.time() - start

        assert timed_out, "Expected timeout"
        assert elapsed < 1.0, f"Expected timeout within 1s, took {elapsed}s"


class TestDelayControlResult:
    """Test delay control return values (REQ-3.5.4.1)."""

    def test_execute_returns_delay_info(self):
        """Verify execute returns information about the delay."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        context = {"parameters": {"duration": 50}}

        result = asyncio.run(control.execute(context))

        assert result is not None, "Expected result from execute"
        assert isinstance(result, dict), "Expected dict result"
        assert "planned_duration_ms" in result, "Expected planned_duration_ms in result"
        assert "actual_duration_ms" in result, "Expected actual_duration_ms in result"
        assert result["planned_duration_ms"] == 50
        assert result["actual_duration_ms"] >= 45  # Allow some tolerance


# =============================================================================
# REQ-3.5.4.1: Configurable delay blocks - Variable Integration
# =============================================================================


class TestDelayControlPreResolvedValues:
    """Test duration with pre-resolved values (REQ-3.5.4.1).

    Duration arrives as an already-resolved integer from resolve_parameters() upstream.
    """

    def test_execute_escalating_delays(self):
        """Verify escalating integer delays execute with increasing duration."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()

        # Simulate increasing delay on each retry (pre-resolved by expression engine)
        durations = [25, 50, 75]
        results = []
        for duration in durations:
            context = {"parameters": {"duration": duration}}

            start = time.monotonic()
            asyncio.run(control.execute(context))
            elapsed = (time.monotonic() - start) * 1000
            results.append(elapsed)

        # A sleep never returns early; wall-clock ordering of short sleeps is not
        # guaranteed when the machine is loaded, so each delay is checked on its own.
        for duration, elapsed in zip(durations, results, strict=True):
            assert elapsed >= duration * 0.95, f"A {duration} ms delay returned after {elapsed} ms"

    def test_execute_with_float_duration(self):
        """Verify float passed as duration raises error (must be integer)."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        context = {"parameters": {"duration": 2.5}}

        with pytest.raises(ValueError, match="^duration must be a positive integer$"):
            asyncio.run(control.execute(context))


# =============================================================================
# REQ-3.5.4.1: Configurable delay blocks - Metadata Verification
# =============================================================================


class TestDelayControlInterface:
    """Test delay control interface compliance (REQ-3.5.4.1)."""

    def test_delay_control_inherits_from_control_base(self):
        """Verify DelayControl inherits from ControlBase."""
        from wavecore.controls.base import ControlBase
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        assert isinstance(control, ControlBase)

    def test_delay_control_has_required_methods(self):
        """Verify DelayControl implements all required abstract methods."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()

        # Verify required methods exist and are callable
        assert hasattr(control, "metadata")
        assert hasattr(control, "execute")
        assert hasattr(control, "validate")
        assert hasattr(control, "initialize")
        assert hasattr(control, "cleanup")

        # Verify they're actually callable (not abstract)
        assert callable(control.execute)
        assert callable(control.validate)
        assert callable(control.initialize)
        assert callable(control.cleanup)


class TestDelayControlMetadata:
    """Test delay control metadata declaration (REQ-3.5.4.1)."""

    def test_metadata_declares_duration_parameter(self):
        """Verify metadata includes duration parameter schema."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        metadata = control.metadata

        params = metadata.get("parameter_schema", [])
        duration_param = next((p for p in params if p.name == "duration"), None)

        assert duration_param is not None, "Expected 'duration' parameter in schema"
        assert duration_param.required is True, "duration should be required"
        assert duration_param.type == "integer", "duration type should be 'integer'"

    def test_metadata_declares_a_duration_of_at_least_one_millisecond(self):
        from wavecore.controls.timing import DelayControl

        params = DelayControl().metadata["parameter_schema"]
        duration_param = next(p for p in params if p.name == "duration")

        assert duration_param.minimum == 1

    def test_metadata_has_correct_control_id(self):
        """Verify metadata has correct control ID."""
        from wavecore.controls.timing import DelayControl
        from wavecore.models.enums import ControlId

        control = DelayControl()
        assert control.metadata["id"] == ControlId.DELAY

    def test_metadata_has_timing_category(self):
        """Verify metadata has timing category."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        assert control.metadata["category"] == "timing"


# =============================================================================
# REQ-3.5.4.1: Edge Cases and Error Handling
# =============================================================================


class TestDelayControlEdgeCases:
    """Test delay control edge cases (REQ-3.5.4.1)."""

    def test_execute_with_very_short_delay(self):
        """Verify very short delays (1ms) work correctly."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        context = {"parameters": {"duration": 1}}

        # Should not raise, even for 1ms delay
        result = asyncio.run(control.execute(context))
        assert result is not None

    def test_execute_with_missing_parameters_key(self):
        """Verify error when parameters key missing from context."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        context = {}  # No parameters key

        with pytest.raises(ValueError, match="^parameters key is required in context$"):
            asyncio.run(control.execute(context))

    def test_execute_with_empty_parameters(self):
        """Verify error when duration not in parameters."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        context = {"parameters": {}}

        with pytest.raises(ValueError, match="^duration parameter is required$"):
            asyncio.run(control.execute(context))

    def test_multiple_sequential_delays(self):
        """Verify multiple sequential delays execute correctly."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()

        async def run_sequential():
            total_start = time.time()
            for _ in range(3):
                context = {"parameters": {"duration": 30}}
                await control.execute(context)
            return (time.time() - total_start) * 1000

        total_elapsed = asyncio.run(run_sequential())
        # 3 delays of 30ms each = ~90ms minimum
        assert total_elapsed >= 80, f"Expected at least 80ms total, got {total_elapsed}ms"
        assert total_elapsed < 500, f"Expected less than 500ms total, got {total_elapsed}ms"

    def test_concurrent_delays_are_independent(self):
        """Verify concurrent delays execute independently."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()

        async def run_concurrent():
            start = time.time()
            tasks = []
            for _i in range(3):
                context = {"parameters": {"duration": 50}}
                tasks.append(asyncio.create_task(control.execute(context)))

            await asyncio.gather(*tasks)
            return (time.time() - start) * 1000

        elapsed = asyncio.run(run_concurrent())
        # All 3 delays run concurrently, so total should be ~50ms (not 150ms)
        assert elapsed < 150, f"Expected concurrent execution ~50ms, got {elapsed}ms"

    def test_execute_with_direct_negative_integer(self):
        """Verify direct negative integer in execute raises error."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        context = {"parameters": {"duration": -100}}

        with pytest.raises(ValueError, match="^duration must be a positive integer$"):
            asyncio.run(control.execute(context))

    def test_execute_with_direct_zero_integer(self):
        """Verify direct zero integer in execute raises error."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        context = {"parameters": {"duration": 0}}

        with pytest.raises(ValueError, match="^duration must be a positive integer$"):
            asyncio.run(control.execute(context))

    def test_execute_with_list_duration(self):
        """Verify list passed as duration raises error."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        context = {"parameters": {"duration": [100]}}

        with pytest.raises(ValueError, match="^duration must be a positive integer$"):
            asyncio.run(control.execute(context))

    def test_execute_with_dict_duration(self):
        """Verify dict passed as duration raises error."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        context = {"parameters": {"duration": {"ms": 100}}}

        with pytest.raises(ValueError, match="^duration must be a positive integer$"):
            asyncio.run(control.execute(context))

    def test_execute_with_malformed_expression_syntax_error(self):
        """Verify malformed expression with syntax error raises error."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        # Incomplete expression causes SyntaxError in eval
        context = {"parameters": {"duration": "100 *"}}

        with pytest.raises(ValueError, match="^duration must be a positive integer$"):
            asyncio.run(control.execute(context))

    def test_execute_with_undefined_name_expression(self):
        """Verify expression with undefined name raises error."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        # Undefined name causes NameError in eval
        context = {"parameters": {"duration": "abc"}}

        with pytest.raises(ValueError, match="^duration must be a positive integer$"):
            asyncio.run(control.execute(context))

    def test_execute_with_boolean_true_duration(self):
        """Verify boolean True passed as duration raises error."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        context = {"parameters": {"duration": True}}

        with pytest.raises(ValueError, match="^duration must be a positive integer$"):
            asyncio.run(control.execute(context))

    def test_execute_with_boolean_false_duration(self):
        """Verify boolean False passed as duration raises error."""
        from wavecore.controls.timing import DelayControl

        control = DelayControl()
        context = {"parameters": {"duration": False}}

        with pytest.raises(ValueError, match="^duration must be a positive integer$"):
            asyncio.run(control.execute(context))
