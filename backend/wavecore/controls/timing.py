"""
Timing control implementations.

Requirements implemented:
- REQ-3.5.0.10: Control base class with metadata declaration
- REQ-3.5.0.12: Control registration at application startup
- REQ-3.5.4.1: Configurable delay blocks
"""

import asyncio
import logging
import time
from typing import Any

from wavecore.controls.base import ControlBase
from wavecore.core.number_rule import is_integer_value
from wavecore.models.controls.parameters import ControlParameter
from wavecore.models.enums import ControlId


def _is_positive_integer(value: Any) -> bool:
    """Check if value is a positive integer (not float, not bool)."""
    return is_integer_value(value) and value > 0


def _evaluate_duration(duration_value: Any) -> int:
    """
    Validate and return duration value.

    Duration must be a positive integer (milliseconds). Post expression-migration,
    values arrive already resolved by resolve_parameters() upstream.

    Args:
        duration_value: The duration parameter value (must be positive int)

    Returns:
        Duration in milliseconds as positive integer

    Raises:
        ValueError: If value is not a positive integer
    """
    if not _is_positive_integer(duration_value):
        raise ValueError("duration must be a positive integer")
    return int(duration_value)


class DelayControl(ControlBase):
    """
    Delay control (REQ-3.5.4.1).

    Pauses execution for a specified duration in milliseconds.
    Uses async sleep to yield to event loop without consuming CPU.
    """

    CONTROL_ID = ControlId.DELAY
    CONTROL_VERSION = "1.0.0"
    CONTROL_NAME = "Delay"
    CONTROL_CATEGORY = "timing"

    @property
    def metadata(self) -> dict[str, Any]:
        """Return Delay control metadata."""
        return {
            "id": self.CONTROL_ID,
            "version": self.CONTROL_VERSION,
            "name": self.CONTROL_NAME,
            "description": "Pause execution for a specified duration",
            "category": self.CONTROL_CATEGORY,
            "icon_name": "clock",
            "parameter_schema": [
                ControlParameter(
                    name="duration",
                    type="integer",
                    required=True,
                    minimum=1,
                    description="Duration to pause in milliseconds",
                ),
            ],
            "output_schema": [],
            "structure_hints": {
                "type": "sequential",
            },
        }

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """
        Execute Delay control (REQ-3.5.4.1).

        Suspends execution for the specified duration using async sleep.

        Args:
            context: Execution context containing:
                - parameters: Dict with 'duration' key (positive integer, ms)
                - logger: Optional session logger for console output

        Returns:
            Dict with planned_duration_ms and actual_duration_ms

        Raises:
            ValueError: If parameters or duration invalid
        """
        # Use session logger if available (logs to both console and backend),
        # otherwise fall back to Python logger (backend only)
        session_logger = context.get("logger")
        fallback_logger = logging.getLogger(__name__)

        def log_info(msg: str, *args: Any) -> None:
            formatted = msg % args if args else msg
            if session_logger:
                session_logger.info(formatted)
            else:
                fallback_logger.info(formatted)

        # Validate context has parameters
        if "parameters" not in context:
            raise ValueError("parameters key is required in context")

        params = context["parameters"]

        # Validate duration exists
        if "duration" not in params:
            raise ValueError("duration parameter is required")

        # Validate and extract duration
        duration_ms = _evaluate_duration(params["duration"])

        # Log start
        log_info("Delay: waiting %d ms", duration_ms)

        # Execute delay using async sleep (non-blocking)
        start_time = time.time()
        await asyncio.sleep(duration_ms / 1000.0)
        actual_elapsed_ms = (time.time() - start_time) * 1000

        # Log completion
        log_info(
            "Wait complete (%.0f ms elapsed)",
            actual_elapsed_ms,
        )

        return {
            "planned_duration_ms": duration_ms,
            "actual_duration_ms": actual_elapsed_ms,
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """
        Validate Delay parameters at design time (REQ-3.5.4.1).

        Accepts:
        - Positive literal integers: 5000

        Rejects:
        - Non-integer types (strings, floats, booleans, None, lists, dicts)
        - Negative integers: -100
        - Zero: 0

        Args:
            params: Parameter values containing 'duration'

        Raises:
            ValueError: If duration is missing or invalid
        """
        if "duration" not in params:
            raise ValueError("duration parameter is required")

        duration = params["duration"]

        if not _is_positive_integer(duration):
            raise ValueError("duration must be a positive integer")

        return None


class WaitUntilControl(ControlBase):
    """
    Wait Until control.

    Waits until an assertion set becomes true or the timeout expires,
    optionally running a retry sub-flow between checks.
    """

    CONTROL_ID = ControlId.WAIT_UNTIL
    CONTROL_VERSION = "1.0.0"
    CONTROL_NAME = "Wait Until"
    CONTROL_CATEGORY = "timing"

    @property
    def metadata(self) -> dict[str, Any]:
        """Return Wait Until control metadata."""
        return {
            "id": self.CONTROL_ID,
            "version": self.CONTROL_VERSION,
            "name": self.CONTROL_NAME,
            "description": "Wait until condition becomes true or timeout expires",
            "category": self.CONTROL_CATEGORY,
            "icon_name": "hourglass",
            "parameter_schema": [
                ControlParameter(
                    name="conditions",
                    type="array",
                    required=True,
                    description="Assertion conditions evaluated each round",
                ),
                ControlParameter(
                    name="timeout",
                    type="integer",
                    required=True,
                    minimum=1,
                    description="Maximum time to wait in milliseconds",
                ),
                ControlParameter(
                    name="check_interval",
                    type="integer",
                    required=False,
                    default=1000,
                    minimum=1,
                    description="Interval between condition checks in milliseconds",
                ),
                ControlParameter(
                    name="message",
                    type="string",
                    required=False,
                    description="Message logged when the wait gives up",
                ),
                ControlParameter(
                    name="mode",
                    type="string",
                    required=False,
                    default="retry",
                    description="Wait mode: 'retry' (sub-flow lane) or 'watch' (condition only)",
                    enum_values=["retry", "watch"],
                ),
                ControlParameter(
                    name="fail_current_scope",
                    type="boolean",
                    required=False,
                    default=False,
                    description="When true, giving up fails the block and stops the flow",
                ),
            ],
            "output_schema": [
                {"name": "passed", "type": "boolean"},
                {"name": "elapsed", "type": "integer"},
            ],
            "structure_hints": {
                "type": "looping",
                "has_body": True,
                "branches": ["retry", "then"],
                "egress": "then",
            },
        }

    async def execute(self, context: dict[str, Any]) -> Any:
        """Execute Wait Until - return signals for the engine to run the rounds."""
        if "parameters" not in context:
            raise ValueError("parameters key is required in context")

        params = context["parameters"]
        mode = params.get("mode", "retry")
        check_interval = params.get("check_interval", 1000)

        logger = context.get("logger")
        if logger:
            logger.info(f"Wait Until: mode={mode}, interval={check_interval} ms")

        return {
            "__wait_until": True,
            "__condition": params.get("conditions", []),
            "__wait_timeout": params.get("timeout"),
            "__check_interval": check_interval,
            "__wait_message": params.get("message"),
            "__wait_fail_scope": params.get("fail_current_scope", False),
            "__mode": mode,
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate Wait Until parameters."""
        if "conditions" not in params:
            raise ValueError("conditions parameter is required")
        conditions = params["conditions"]
        if not isinstance(conditions, list):
            raise ValueError("conditions must be a list")
        if not conditions:
            raise ValueError("at least one condition is required")

        if "timeout" not in params:
            raise ValueError("timeout parameter is required")
        if not _is_positive_integer(params["timeout"]):
            raise ValueError("timeout must be a positive integer")

        check_interval = params.get("check_interval")
        if check_interval is not None and not _is_positive_integer(check_interval):
            raise ValueError("check_interval must be a positive integer")

        if "mode" in params and params["mode"] not in ("retry", "watch"):
            raise ValueError("mode must be 'retry' or 'watch'")
