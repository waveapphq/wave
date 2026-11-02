"""
Loop control implementations.

Requirements implemented:
- REQ-3.5.0.10: Control base class with metadata declaration
- REQ-3.5.0.12: Control registration at application startup
"""

from typing import Any

from wavecore.controls.base import ControlBase
from wavecore.core.number_rule import is_integer_value
from wavecore.core.table import Table
from wavecore.models.controls.parameters import ControlParameter, RequiredWhen
from wavecore.models.enums import ControlId

_COLLECTION_TYPE_ERROR = "collection must be a list, dict, or table"


class ForControl(ControlBase):
    """
    For loop control.

    Iterates over a numeric range with a counter variable,
    executing the loop body for each iteration.

    REQ-3.5.1.15: For loop with counter variable
    """

    CONTROL_ID = ControlId.FOR
    CONTROL_VERSION = "1.0.0"
    CONTROL_NAME = "For Loop"
    CONTROL_CATEGORY = "loop"

    @property
    def metadata(self) -> dict[str, Any]:
        """Return For loop control metadata."""
        return {
            "id": self.CONTROL_ID,
            "version": self.CONTROL_VERSION,
            "name": self.CONTROL_NAME,
            "description": "Iterate over a numeric range with counter variable",
            "category": self.CONTROL_CATEGORY,
            "icon_name": "repeat",
            "parameter_schema": [
                ControlParameter(
                    name="mode",
                    type="string",
                    required=True,
                    default="count",
                    description="Iteration mode",
                    enum_values=["count", "range"],
                ),
                ControlParameter(
                    name="count",
                    type="integer",
                    required_when=RequiredWhen(field="mode", values=["count"]),
                    accepts_null=True,
                    description="Number of iterations",
                ),
                ControlParameter(
                    name="start",
                    type="integer",
                    required_when=RequiredWhen(field="mode", values=["range"]),
                    description="Starting value (inclusive)",
                ),
                ControlParameter(
                    name="end",
                    type="integer",
                    required_when=RequiredWhen(field="mode", values=["range"]),
                    description="Ending value (exclusive)",
                ),
                ControlParameter(
                    name="step",
                    type="integer",
                    required=True,
                    default=1,
                    description="Increment per iteration",
                ),
                ControlParameter(
                    name="timeout",
                    type="float",
                    required=False,
                    description="Max execution time in seconds",
                ),
            ],
            "output_schema": [
                {"name": "index", "type": "integer"},
            ],
            "structure_hints": {
                "type": "looping",
                "has_body": True,
                "branches": ["body", "then"],
                "egress": "then",
            },
        }

    async def execute(self, context: dict[str, Any]) -> Any:
        """Execute For loop - return signals for engine to iterate."""
        params = context.get("parameters", {})
        mode = params.get("mode", "count")
        step = params.get("step", 1)

        if mode == "count":
            # A null count holds nothing, so the loop runs zero times (REQ-3.1.3.25).
            count = params.get("count")
            loop_start: int = 0
            loop_end: int = 0 if count is None else count
        else:
            loop_start = params.get("start", 0)
            loop_end = params.get("end", 0)

        initial_index: int = loop_start

        logger = context.get("logger")
        if logger:
            total = max(0, -(-(loop_end - loop_start) // step)) if step else 0
            logger.info(f"For loop: mode={mode}, iterations={total}, step={step}")

        return {
            "__for_loop": True,
            "__loop_start": loop_start,
            "__loop_end": loop_end,
            "__loop_step": step,
            "__loop_variable": "index",
            "__timeout": params.get("timeout"),
            "index": initial_index,
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate For loop parameters."""
        mode = params.get("mode", "count")
        if mode not in ("count", "range"):
            raise ValueError("mode must be 'count' or 'range'")

        if mode == "count":
            if "count" not in params:
                raise ValueError("count is required when mode is 'count'")
            count = params["count"]
            if is_integer_value(count) and count < 0:
                raise ValueError("count must be >= 0")
        else:
            if "start" not in params:
                raise ValueError("start is required when mode is 'range'")
            if "end" not in params:
                raise ValueError("end is required when mode is 'range'")

        step = params.get("step")
        if step is not None and step == 0:
            raise ValueError("step must not be zero")


class ForEachControl(ControlBase):
    """
    For-Each loop control.

    Iterates over collection elements with typed envelope wrapping,
    executing the loop body for each element.

    REQ-3.5.1.16: For-Each loop with typed envelope iteration
    """

    CONTROL_ID = ControlId.FOR_EACH
    CONTROL_VERSION = "1.0.0"
    CONTROL_NAME = "For Each"
    CONTROL_CATEGORY = "loop"

    @property
    def metadata(self) -> dict[str, Any]:
        """Return For-Each control metadata."""
        return {
            "id": self.CONTROL_ID,
            "version": self.CONTROL_VERSION,
            "name": self.CONTROL_NAME,
            "description": "Iterate over collection elements with typed envelope wrapping",
            "category": self.CONTROL_CATEGORY,
            "icon_name": "list",
            "parameter_schema": [
                ControlParameter(
                    name="collection",
                    type=["array", "map", "table"],
                    required=True,
                    variable_ref=True,
                    accepts_null=True,
                    description=(
                        "Collection to iterate over (array, map, or table); a null item "
                        "is passed on as null"
                    ),
                ),
                ControlParameter(
                    name="collection_type",
                    type="string",
                    required=False,
                    enum_values=["array", "map", "table"],
                    description=(
                        "The collection's type as picked in the window: array, map or table. "
                        "The run reads the collection's own type."
                    ),
                ),
                ControlParameter(
                    name="timeout",
                    type="float",
                    required=False,
                    description="Max execution time in seconds",
                ),
            ],
            "output_schema": [
                {"name": "item", "type": "map"},
                {"name": "index", "type": "integer"},
            ],
            "structure_hints": {
                "type": "looping",
                "has_body": True,
                "branches": ["body", "then"],
                "egress": "then",
            },
        }

    async def execute(self, context: dict[str, Any]) -> Any:
        """Execute For-Each loop - return signals for engine to iterate."""
        params = context.get("parameters", {})
        resolved = resolve_collection(params.get("collection", []))

        # Build typed envelope for first item, or empty dict for empty collection
        if resolved:
            item_envelope = _wrap_item(resolved[0])
        else:
            item_envelope = {}

        return {
            "__for_each": True,
            "__collection": resolved,
            "__item_variable": "item",
            "__index_variable": "index",
            "__timeout": params.get("timeout"),
            "item": item_envelope,
            "index": 0,
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate For-Each parameters."""
        if "collection" not in params:
            raise ValueError("collection parameter is required")
        collection = params["collection"]
        if collection is not None and not isinstance(collection, list | dict | Table):
            raise ValueError(_COLLECTION_TYPE_ERROR)


def resolve_collection(raw: Any) -> list[Any]:
    """Resolve a collection value to the list of items the loop iterates.

    A table yields one row map per row, so a body node reads
    ``item.value.<column>``; a map yields its keys; a list is already the items;
    null holds no items (REQ-3.1.3.25).
    """
    if raw is None:
        return []
    if isinstance(raw, Table):
        return raw.to_list()
    if isinstance(raw, dict):
        return list(raw.keys())
    if isinstance(raw, list):
        return list(raw)
    raise ValueError(_COLLECTION_TYPE_ERROR)


def _wrap_item(value: Any) -> dict[str, Any]:
    """Create a typed envelope for a collection item based on Python type.

    bool must be checked before int since bool is a subclass of int.
    """
    if isinstance(value, bool):
        return {"type": "boolean", "value": value}
    if isinstance(value, int):
        return {"type": "integer", "value": value}
    if isinstance(value, float):
        return {"type": "float", "value": value}
    if isinstance(value, str):
        return {"type": "string", "value": value}
    if isinstance(value, list):
        return {"type": "array", "value": value}
    if isinstance(value, dict):
        return {"type": "map", "value": value}
    if value is None:
        # Null fits any type, so the envelope type is never read for it.
        return {"type": "string", "value": None}
    return {"type": "string", "value": str(value)}


class WhileControl(ControlBase):
    """
    While loop control.

    Repeats the loop body while a condition remains true.
    Supports While-Do (pre-check) and Do-While (post-check) modes.

    REQ-3.5.1.17: While loop with condition
    """

    CONTROL_ID = ControlId.WHILE
    CONTROL_VERSION = "1.0.0"
    CONTROL_NAME = "While Loop"
    CONTROL_CATEGORY = "loop"

    @property
    def metadata(self) -> dict[str, Any]:
        """Return While loop control metadata."""
        return {
            "id": self.CONTROL_ID,
            "version": self.CONTROL_VERSION,
            "name": self.CONTROL_NAME,
            "description": "Repeat while condition remains true",
            "category": self.CONTROL_CATEGORY,
            "icon_name": "refresh-cw",
            "parameter_schema": [
                ControlParameter(
                    name="mode",
                    type="string",
                    required=True,
                    default="while-do",
                    description="Loop mode: while-do (pre-check) or do-while (post-check)",
                    enum_values=["while-do", "do-while"],
                ),
                ControlParameter(
                    name="conditions",
                    type="array",
                    required=True,
                    description="Assertion conditions evaluated each iteration",
                ),
                ControlParameter(
                    name="max_iterations",
                    type="integer",
                    required=False,
                    description="Maximum iterations - session FAILS if reached",
                ),
                ControlParameter(
                    name="timeout",
                    type="float",
                    required=False,
                    description="Max execution time in seconds - session FAILS if reached",
                ),
            ],
            "output_schema": [
                {"name": "index", "type": "integer"},
            ],
            "structure_hints": {
                "type": "looping",
                "has_body": True,
                "branches": ["body", "then"],
                "egress": "then",
            },
        }

    async def execute(self, context: dict[str, Any]) -> Any:
        """Execute While loop - return signals for engine to iterate."""
        params = context.get("parameters", {})
        mode = params.get("mode", "while-do")
        conditions = params.get("conditions", [])

        logger = context.get("logger")
        if logger:
            logger.info(f"While loop: mode={mode}")

        return {
            "__while_loop": True,
            "__condition": conditions,
            "__mode": mode,
            "__max_iterations": params.get("max_iterations"),
            "__timeout": params.get("timeout"),
            "index": 0,
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate While loop parameters."""
        mode = params.get("mode", "while-do")
        if mode not in ("while-do", "do-while"):
            raise ValueError("mode must be 'while-do' or 'do-while'")

        if "conditions" not in params:
            raise ValueError("conditions parameter is required")

        conditions = params["conditions"]
        if not isinstance(conditions, list):
            raise ValueError("conditions must be a list")

        max_iterations = params.get("max_iterations")
        if max_iterations is not None and (
            not is_integer_value(max_iterations) or max_iterations < 1
        ):
            raise ValueError("max_iterations must be >= 1")


class BreakControl(ControlBase):
    """
    Break control.

    Exits the current loop immediately, continuing execution
    after the loop construct.
    """

    CONTROL_ID = ControlId.BREAK
    CONTROL_VERSION = "1.0.0"
    CONTROL_NAME = "Break"
    CONTROL_CATEGORY = "loop"

    @property
    def metadata(self) -> dict[str, Any]:
        """Return Break control metadata."""
        return {
            "id": self.CONTROL_ID,
            "version": self.CONTROL_VERSION,
            "name": self.CONTROL_NAME,
            "description": "Exit the current loop immediately",
            "category": self.CONTROL_CATEGORY,
            "icon_name": "log-out",
            "parameter_schema": [
                ControlParameter(
                    name="target_loop",
                    type="string",
                    required=True,
                    description="Block ID of the loop to break out of",
                ),
            ],
            "output_schema": [],
            "structure_hints": {
                "type": "sequential",
                "loop_modifier": True,
            },
        }

    async def execute(self, context: dict[str, Any]) -> Any:
        """Execute Break control - return break signal with target."""
        target = context.get("parameters", {}).get("target_loop", "")
        return {"__break": True, "__break_target": target}

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate Break parameters - target_loop is required and non-empty."""
        if "target_loop" not in params:
            raise ValueError("target_loop is required")
        if not str(params["target_loop"]).strip():
            raise ValueError("target_loop must not be empty")


class ContinueControl(ControlBase):
    """
    Continue control.

    Skips to the next loop iteration, bypassing remaining
    statements in the current iteration.
    """

    CONTROL_ID = ControlId.CONTINUE
    CONTROL_VERSION = "1.0.0"
    CONTROL_NAME = "Continue"
    CONTROL_CATEGORY = "loop"

    @property
    def metadata(self) -> dict[str, Any]:
        """Return Continue control metadata."""
        return {
            "id": self.CONTROL_ID,
            "version": self.CONTROL_VERSION,
            "name": self.CONTROL_NAME,
            "description": "Skip to the next loop iteration",
            "category": self.CONTROL_CATEGORY,
            "icon_name": "skip-forward",
            "parameter_schema": [
                ControlParameter(
                    name="target_loop",
                    type="string",
                    required=True,
                    description="Block ID of the loop to continue to next iteration",
                ),
            ],
            "output_schema": [],
            "structure_hints": {
                "type": "sequential",
                "loop_modifier": True,
            },
        }

    async def execute(self, context: dict[str, Any]) -> Any:
        """Execute Continue control - return continue signal with target."""
        target = context.get("parameters", {}).get("target_loop", "")
        return {"__continue": True, "__continue_target": target}

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate Continue parameters - target_loop is required and non-empty."""
        if "target_loop" not in params:
            raise ValueError("target_loop is required")
        if not str(params["target_loop"]).strip():
            raise ValueError("target_loop must not be empty")
