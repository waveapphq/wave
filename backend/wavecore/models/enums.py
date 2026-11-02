"""
WAVE Model Enumerations

Enums for execution states, log levels, and control identifiers.
"""

from enum import Enum, IntEnum


class LogLevel(IntEnum):
    """
    Log level enumeration for plugin log filtering (REQ-3.4.2.6).

    Ordered from most permissive (DEBUG) to most restrictive (NONE).
    Higher numeric values represent more restrictive filtering.
    """

    DEBUG = 10  # Least restrictive - all logs
    INFO = 20
    WARN = 30  # Default threshold
    ERROR = 40
    FATAL = 50
    NONE = 100  # Most restrictive - no logs


class ExecutionState(IntEnum):
    """
    Execution state enumeration for tracking entity lifecycle (REQ-3.2.1.1).

    Represents the current state of an executing entity (regression, suite, test, block, plugin).
    Entities progress through states: PENDING -> RUNNING -> (COMPLETED | FAILED).
    """

    PENDING = 1  # Created but not yet started
    RUNNING = 2  # Currently executing
    COMPLETED = 3  # Successfully completed
    FAILED = 4  # Failed due to error


class ControlCategory(str, Enum):
    """
    Control category enumeration for UI grouping (REQ-3.5.0.2).

    Controls organize into categories for palette grouping in the workflow editor.
    Category derives from control identity rather than stored data.
    """

    CONDITIONAL = "conditional"  # If/Else, Switch/Case, Assert
    LOOP = "loop"  # For, For-Each, While, Break, Continue
    FLOW = "flow"  # Parallel, Try-Catch-Finally, Halt
    TIMING = "timing"  # Delay, Wait-Until
    MISC = "misc"  # Note


class ControlId(str, Enum):
    """
    Control identifier enumeration (REQ-3.5.0.1).

    Fixed set of 15 built-in control constructs. Values are kebab-case
    for API serialization and storage consistency.
    """

    # Conditional (3)
    IF_ELSE = "if-else"
    SWITCH_CASE = "switch-case"
    ASSERT = "assert"

    # Loop (5)
    FOR = "for"
    FOR_EACH = "for-each"
    WHILE = "while"
    BREAK = "break"
    CONTINUE = "continue"

    # Flow (4)
    PARALLEL = "parallel"
    TRY_CATCH_FINALLY = "try-catch-finally"
    HALT = "halt"
    VARIABLE_SETTER = "variable-setter"

    # Timing (2)
    DELAY = "delay"
    WAIT_UNTIL = "wait-until"

    # Misc (1)
    NOTE = "note"


# Category mapping for each control (REQ-3.5.0.2)
_CONTROL_CATEGORY_MAP: dict[ControlId, ControlCategory] = {
    ControlId.IF_ELSE: ControlCategory.CONDITIONAL,
    ControlId.SWITCH_CASE: ControlCategory.CONDITIONAL,
    ControlId.ASSERT: ControlCategory.CONDITIONAL,
    ControlId.FOR: ControlCategory.LOOP,
    ControlId.FOR_EACH: ControlCategory.LOOP,
    ControlId.WHILE: ControlCategory.LOOP,
    ControlId.BREAK: ControlCategory.LOOP,
    ControlId.CONTINUE: ControlCategory.LOOP,
    ControlId.PARALLEL: ControlCategory.FLOW,
    ControlId.TRY_CATCH_FINALLY: ControlCategory.FLOW,
    ControlId.HALT: ControlCategory.FLOW,
    ControlId.VARIABLE_SETTER: ControlCategory.FLOW,
    ControlId.DELAY: ControlCategory.TIMING,
    ControlId.WAIT_UNTIL: ControlCategory.TIMING,
    ControlId.NOTE: ControlCategory.MISC,
}


def get_control_category(control_id: ControlId) -> ControlCategory:
    """
    Get the category for a control (REQ-3.5.0.2).

    Category derives from control identity rather than stored data,
    eliminating synchronization concerns.
    """
    return _CONTROL_CATEGORY_MAP[control_id]


def get_controls_by_category(category: ControlCategory) -> list[ControlId]:
    """
    Get all controls in a category (REQ-3.5.0.2).

    Returns a list of control IDs that belong to the specified category.
    """
    return [control_id for control_id, cat in _CONTROL_CATEGORY_MAP.items() if cat == category]
