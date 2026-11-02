"""
Flow control implementations.

Requirements implemented:
- REQ-3.5.0.10: Control base class with metadata declaration
- REQ-3.5.0.12: Control registration at application startup
"""

from typing import Any

from wavecore.controls.base import ControlBase
from wavecore.core.number_rule import number_problem, parse_number
from wavecore.models.controls.parameters import ControlParameter
from wavecore.models.enums import ControlId
from wavecore.plugins._executor_base import validate_enum_param

_JOIN_MODES: list[str | int | float] = ["all", "first"]


def time_limit_ms(value: Any) -> int | None:
    """A time limit's whole positive milliseconds, its digit text included; None when it is none."""
    if number_problem(value, "integer") is not None:
        return None
    limit = int(parse_number(value, "integer"))
    return limit if limit > 0 else None


def is_time_limit(value: Any) -> bool:
    """A time limit is a whole positive number of milliseconds; True is not 1 ms."""
    return time_limit_ms(value) is not None


class ParallelControl(ControlBase):
    """
    Parallel execution control.

    A container: named branch lanes whose bodies run concurrently over the
    test's live variables, plus one always-present 'then' egress that is the
    join. Emits the branch descriptors as an engine signal; the workbench
    dispatcher forks the lanes and releases the join per the join mode.
    """

    CONTROL_ID = ControlId.PARALLEL
    CONTROL_VERSION = "1.0.0"
    CONTROL_NAME = "Parallel"
    CONTROL_CATEGORY = "flow"

    @property
    def metadata(self) -> dict[str, Any]:
        """Return Parallel control metadata."""
        return {
            "id": self.CONTROL_ID,
            "version": self.CONTROL_VERSION,
            "name": self.CONTROL_NAME,
            "description": "Execute multiple branches concurrently with fork-join semantics",
            "category": self.CONTROL_CATEGORY,
            "icon_name": "git-merge",
            "parameter_schema": [
                ControlParameter(
                    name="branches",
                    type="array",
                    required=True,
                    description=(
                        "Branch lanes, each with an id, an optional name and an "
                        "optional time limit in milliseconds"
                    ),
                ),
                ControlParameter(
                    name="join",
                    type="string",
                    required=False,
                    default="all",
                    description="Join mode: 'all' waits for every branch, 'first' for the first",
                    enum_values=_JOIN_MODES,
                ),
                ControlParameter(
                    name="time_limit",
                    type="integer",
                    required=False,
                    description="Optional limit for the whole section in milliseconds",
                ),
            ],
            "output_schema": [],
            "structure_hints": {
                "type": "scoped",
                "branches": ["branch_1", "branch_2", "then"],
                "egress": "then",
                "allows_dynamic_branches": True,
            },
        }

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Emit the container signal carrying every branch descriptor."""
        params = context.get("parameters", {})
        return {
            "__parallel": True,
            "__branches": params.get("branches") or [],
            "__join": params.get("join") or "all",
            "__time_limit": params.get("time_limit"),
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate Parallel parameters.

        Enforces, in order: the join enum, at least two branches, a positive
        section limit, and a positive limit on every branch that carries one.
        """
        if "join" in params:
            validate_enum_param("join", params["join"], _JOIN_MODES)

        branches = params.get("branches")
        if not isinstance(branches, list) or len(branches) < 2:
            raise ValueError("Parallel requires at least 2 branches")

        time_limit = params.get("time_limit")
        if time_limit is not None and not is_time_limit(time_limit):
            raise ValueError("Parallel time limit must be a positive integer")

        for branch in branches:
            if not isinstance(branch, dict):
                continue
            branch_limit = branch.get("time_limit")
            if branch_limit is not None and not is_time_limit(branch_limit):
                raise ValueError("Parallel branch time limit must be a positive integer")


class TryCatchFinallyControl(ControlBase):
    """
    Try/Catch/Finally error handling control.

    Provides structured error handling with scoped dead-end paths
    and an explicit egress handle for returning to the main flow.
    """

    CONTROL_ID = ControlId.TRY_CATCH_FINALLY
    CONTROL_VERSION = "1.0.0"
    CONTROL_NAME = "Try/Catch/Finally"
    CONTROL_CATEGORY = "flow"

    @property
    def metadata(self) -> dict[str, Any]:
        """Return Try/Catch/Finally control metadata."""
        return {
            "id": self.CONTROL_ID,
            "version": self.CONTROL_VERSION,
            "name": self.CONTROL_NAME,
            "description": "Structured error handling with catch and cleanup paths",
            "category": self.CONTROL_CATEGORY,
            "icon_name": "shield-check",
            "parameter_schema": [
                ControlParameter(
                    name="enable_catch",
                    type="boolean",
                    required=False,
                    default=True,
                    description="Enable catch output handle for error handling path",
                ),
                ControlParameter(
                    name="enable_finally",
                    type="boolean",
                    required=False,
                    default=False,
                    description="Enable finally output handle for guaranteed cleanup path",
                ),
            ],
            "output_schema": [
                {"name": "error", "type": "map"},
                {"name": "caught", "type": "boolean"},
            ],
            "structure_hints": {
                "type": "scoped",
                "branches": ["try", "catch", "finally", "then"],
                "egress": "then",
            },
        }

    async def execute(self, context: dict[str, Any]) -> Any:
        """Execute Try/Catch/Finally - returns signals for engine consumption."""
        params = context.get("parameters", {})
        enable_catch = params.get("enable_catch", True)
        enable_finally = params.get("enable_finally", False)

        logger = context.get("logger")
        if logger:
            logger.info(f"Try/Catch: catch={enable_catch}, finally={enable_finally}")

        return {
            "__branch": "try",
            "__try_catch": True,
            "__enable_catch": enable_catch,
            "__enable_finally": enable_finally,
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate Try/Catch/Finally parameters."""


class HaltControl(ControlBase):
    """
    Halt execution control.

    Stops execution at a specified scope (test, suite, or regression).
    Used to terminate execution based on conditions.
    """

    CONTROL_ID = ControlId.HALT
    CONTROL_VERSION = "1.0.0"
    CONTROL_NAME = "Halt"
    CONTROL_CATEGORY = "flow"

    @property
    def metadata(self) -> dict[str, Any]:
        """Return Halt control metadata."""
        return {
            "id": self.CONTROL_ID,
            "version": self.CONTROL_VERSION,
            "name": self.CONTROL_NAME,
            "description": "Stop execution at specified scope (test, suite, regression, function)",
            "category": self.CONTROL_CATEGORY,
            "icon_name": "octagon",
            "parameter_schema": [
                ControlParameter(
                    name="scope",
                    type="string",
                    required=False,
                    default="test",
                    enum_values=["test", "suite", "regression", "function"],
                    description="Scope to halt: test, suite, regression, or function",
                ),
                ControlParameter(
                    name="message",
                    type="string",
                    required=False,
                    description="Reason for halting execution",
                ),
                ControlParameter(
                    name="status",
                    type="string",
                    required=False,
                    default="failed",
                    enum_values=["passed", "failed", "skipped"],
                    description="Status to set on halt: passed, failed, skipped",
                ),
            ],
            "output_schema": [],
            "structure_hints": {
                "type": "sequential",
                "terminating": True,
            },
        }

    async def execute(self, context: dict[str, Any]) -> Any:
        """Execute Halt control - returns __halt signal for engine consumption."""
        params = context.get("parameters", {})
        scope = params.get("scope", "test")
        status = params.get("status", "failed")
        message = params.get("message")

        logger = context.get("logger")
        if logger:
            log_msg = f"Halt ({scope}): {message}" if message else f"Halt ({scope})"
            if status == "passed":
                logger.info(log_msg)
            elif status == "failed":
                logger.error(log_msg)
            else:
                logger.warn(log_msg)

        return {
            "__halt": True,
            "__halt_scope": scope,
            "__halt_status": status,
            "__halt_message": message,
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate Halt parameters."""
        scope = params.get("scope", "test")
        scope_param = next(p for p in self.metadata["parameter_schema"] if p.name == "scope")
        validate_enum_param("scope", scope, scope_param.enum_values or [])
        status = params.get("status", "failed")
        status_param = next(p for p in self.metadata["parameter_schema"] if p.name == "status")
        validate_enum_param("status", status, status_param.enum_values or [])
