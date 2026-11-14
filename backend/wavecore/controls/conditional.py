"""
Conditional control implementations.

Requirements implemented:
- REQ-3.5.0.10: Control base class with metadata declaration
- REQ-3.5.0.12: Control registration at application startup
"""

from collections.abc import Collection, Mapping
from typing import Any

from wavecore.controls.assertion_evaluator import (
    UNARY_OPERATORS,
    condition_join_problems,
    evaluate_assertions,
)
from wavecore.controls.base import ControlBase, duplicate_branch_id, raise_first_problem
from wavecore.core.execution.field_checks import FieldFinding
from wavecore.core.variables.print_form import value_text
from wavecore.models.controls.parameters import ControlParameter
from wavecore.models.enums import ControlId

_VALID_BRANCH_TYPES = {"if", "else_if", "else"}
_VALID_SWITCH_BRANCH_TYPES = {"case", "default"}


def _structure(message: str, field: str, code: str = "INVALID_CONTROL_STRUCTURE") -> FieldFinding:
    return FieldFinding(code, message, None, field)


def _branch_list(values: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """The branches as records; a value that is no list is left to the shared checks."""
    branches = values.get("branches")
    if not isinstance(branches, list):
        return []
    return [branch if isinstance(branch, Mapping) else {} for branch in branches]


def _branches_shape(params: Mapping[str, Any]) -> None:
    """The run's own shape lines, kept before the structure rules."""
    if "branches" not in params:
        raise ValueError("branches parameter is required")
    branches = params["branches"]
    if not isinstance(branches, list):
        raise ValueError("branches must be a list")
    if len(branches) == 0:
        raise ValueError("branches must not be empty")


def _if_else_branch_problems(
    branch: Mapping[str, Any], index: int, total: int, seen: set[Any]
) -> list[FieldFinding]:
    """One If/Else branch: type, id, else last, else conditions, if first, conditions."""
    branch_type = branch.get("type")
    at = f"branches.{index}"
    if branch_type not in _VALID_BRANCH_TYPES:
        return [_structure(f"invalid branch type: {branch_type!r}", f"{at}.type")]
    problems = duplicate_branch_id(branch, index, seen)
    if branch_type == "else":
        if index != total - 1:
            problems.append(_structure("else branch must be last", f"{at}.type"))
        if branch.get("conditions"):
            problems.append(_structure("else branch must not have conditions", f"{at}.conditions"))
        return problems
    if branch_type == "if" and index != 0:
        problems.append(_structure("if branch must be first", f"{at}.type"))
    if not branch.get("conditions"):
        message = f"{branch_type} branch must have conditions"
        problems.append(_structure(message, f"{at}.conditions", "REQUIRED_PARAM_EMPTY"))
    return problems


def _switch_composition_problems(branches: list[Mapping[str, Any]]) -> list[FieldFinding]:
    """The case and default mix and the default's trailing place."""
    problems: list[FieldFinding] = []
    defaults = [index for index, branch in enumerate(branches) if branch.get("type") == "default"]
    if len(defaults) > 1:
        problems.append(_structure("only one default branch allowed", "branches"))
    if not any(branch.get("type") == "case" for branch in branches):
        problems.append(_structure("at least one case branch is required", "branches"))
    if defaults and defaults[0] != len(branches) - 1:
        problems.append(_structure("default branch must be last", f"branches.{defaults[0]}.type"))
    return problems


def _switch_body_problems(branch: Mapping[str, Any], index: int) -> list[FieldFinding]:
    """One branch's conditions and break against its type."""
    at = f"branches.{index}"
    problems: list[FieldFinding] = []
    if branch.get("type") == "default":
        if branch.get("conditions"):
            message = "default branch must not have conditions"
            problems.append(_structure(message, f"{at}.conditions"))
        if "break" in branch:
            problems.append(_structure("default branch must not have break", f"{at}.break"))
        return problems
    if not branch.get("conditions"):
        message = "case branch must have conditions"
        problems.append(_structure(message, f"{at}.conditions", "REQUIRED_PARAM_EMPTY"))
    if "break" in branch and not isinstance(branch["break"], bool):
        problems.append(_structure("break must be a boolean", f"{at}.break"))
    return problems


def _branch_join_problems(params: Mapping[str, Any]) -> list[FieldFinding]:
    """The join check of every branch's condition list."""
    problems: list[FieldFinding] = []
    for index, branch in enumerate(_branch_list(params)):
        place = f"branches.{index}.conditions"
        problems.extend(condition_join_problems(branch.get("conditions"), place))
    return problems


class IfElseControl(ControlBase):
    """
    If/Else N-branch conditional control.

    Evaluates assertion-style conditions per branch and routes execution
    down the first matching path. Supports if, else_if, and else branches.
    Reuses evaluate_assertions() from the assertion evaluator.
    """

    CONTROL_ID = ControlId.IF_ELSE
    CONTROL_VERSION = "1.0.0"
    CONTROL_NAME = "If/Else"
    CONTROL_CATEGORY = "conditional"

    @property
    def metadata(self) -> dict[str, Any]:
        """Return If/Else control metadata."""
        return {
            "id": self.CONTROL_ID,
            "version": self.CONTROL_VERSION,
            "name": self.CONTROL_NAME,
            "description": "Conditional branching based on expression evaluation",
            "category": self.CONTROL_CATEGORY,
            "icon_name": "git-branch",
            "parameter_schema": [
                ControlParameter(
                    name="branches",
                    type="array",
                    required=True,
                    description=("Ordered list of branches with type, id, label, and conditions"),
                ),
            ],
            "output_schema": [],
            "structure_hints": {
                "type": "branching",
                "branches": ["branch_0", "branch_1"],
                "allows_dynamic_branches": True,
            },
        }

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Execute If/Else conditional logic.

        Iterates through branches in order, evaluating conditions for
        if/else_if branches. Returns the first matching branch id.
        An else branch is always taken when reached.

        Exceptions from the evaluator (KeyError, TypeError, ValueError,
        etc.) propagate to the caller - they are not caught here.
        """
        params = context["parameters"]
        variables = context["variables"]
        logger = context.get("logger")

        branches = params["branches"]

        for i, branch in enumerate(branches):
            branch_type = branch["type"]
            branch_id = branch.get("id", f"branch_{i}")
            branch_label = branch.get("label", "")

            if branch_type == "else":
                # Else is always taken when reached
                display = branch_label or f"else (branch {i + 1})"
                if logger:
                    logger.info(f"Branch taken: {display}")
                return {"__branch": branch_id}

            # if or else_if: evaluate conditions
            conditions = branch.get("conditions", [])
            result = evaluate_assertions(conditions, variables)

            if result.passed:
                display = branch_label or f"{branch_type} (branch {i + 1})"
                if logger:
                    logger.info(f"Branch taken: {display}")
                return {"__branch": branch_id}

        # No branch matched, no else present
        if logger:
            logger.info("All conditions evaluated and failed, end of flow")
        return {"__branch": "__no_match__"}

    def structure_problems(
        self, values: Mapping[str, Any], sources: Collection[str] = ()
    ) -> list[FieldFinding]:
        """The If/Else branch rules, every problem at its place (REQ-3.5.1.1, REQ-3.5.1.6)."""
        branches = _branch_list(values)
        if not branches:
            return []
        problems: list[FieldFinding] = []
        if branches[0].get("type") != "if":
            problems.append(_structure("first branch must be type 'if'", "branches.0.type"))
        seen: set[Any] = set()
        for index, branch in enumerate(branches):
            problems.extend(_if_else_branch_problems(branch, index, len(branches), seen))
        return problems

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate If/Else parameters: the branch list shape, its rules, then its joins."""
        _branches_shape(params)
        raise_first_problem(self.structure_problems(params))
        raise_first_problem(_branch_join_problems(params))


class SwitchCaseControl(ControlBase):
    """
    Switch/Case multi-way branching control.

    A container: ordered condition-guarded case branches, an optional
    trailing default, and an always-present 'then' egress. Emits the
    branch descriptors as an engine signal; the workbench dispatcher
    evaluates each case's conditions at the moment that case is reached.
    """

    CONTROL_ID = ControlId.SWITCH_CASE
    CONTROL_VERSION = "1.0.0"
    CONTROL_NAME = "Switch/Case"
    CONTROL_CATEGORY = "conditional"

    @property
    def metadata(self) -> dict[str, Any]:
        """Return Switch/Case control metadata."""
        return {
            "id": self.CONTROL_ID,
            "version": self.CONTROL_VERSION,
            "name": self.CONTROL_NAME,
            "description": "Multi-way branching with condition-guarded cases",
            "category": self.CONTROL_CATEGORY,
            "icon_name": "list-tree",
            "parameter_schema": [
                ControlParameter(
                    name="branches",
                    type="array",
                    required=True,
                    description=(
                        "Ordered list of case branches with conditions and break, "
                        "plus an optional default"
                    ),
                ),
            ],
            "output_schema": [],
            "structure_hints": {
                "type": "scoped",
                "branches": ["branch_0", "branch_1", "then"],
                "egress": "then",
                "allows_dynamic_branches": True,
            },
        }

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Emit the container signal carrying every branch descriptor.

        No condition is evaluated here: a case's sub-flow can change the
        variables a later case tests, so the dispatcher evaluates each
        case when it is reached.
        """
        return {
            "__switch": True,
            "__switch_branches": context["parameters"]["branches"],
        }

    def structure_problems(
        self, values: Mapping[str, Any], sources: Collection[str] = ()
    ) -> list[FieldFinding]:
        """Identity per branch, then the case and default mix, then each body (REQ-3.5.1.20)."""
        branches = _branch_list(values)
        if not branches:
            return []
        problems: list[FieldFinding] = []
        seen: set[Any] = set()
        known: list[tuple[int, Mapping[str, Any]]] = []
        for index, branch in enumerate(branches):
            branch_type = branch.get("type")
            if branch_type not in _VALID_SWITCH_BRANCH_TYPES:
                message = f"invalid branch type: {branch_type!r}"
                problems.append(_structure(message, f"branches.{index}.type"))
                continue
            problems.extend(duplicate_branch_id(branch, index, seen))
            known.append((index, branch))
        problems.extend(_switch_composition_problems(branches))
        for index, branch in known:
            problems.extend(_switch_body_problems(branch, index))
        return problems

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate Switch/Case parameters: the branch list shape, its rules, then its joins."""
        _branches_shape(params)
        raise_first_problem(self.structure_problems(params))
        raise_first_problem(_branch_join_problems(params))


def _actual_text(value: Any, max_len: int = 1000) -> str:
    """A string stays quoted, any other value uses the print form; both truncated alike."""
    value_str = repr(value) if isinstance(value, str) else value_text(value)
    if len(value_str) > max_len:
        return value_str[:500] + " ... " + value_str[-500:]
    return value_str


def _log_single_failure(detail: dict[str, Any], log_fn: Any) -> None:
    """Log a single assertion failure detail."""
    a = detail["assertion"]
    assertion_type = a.get("type")

    if assertion_type == "literal":
        value_type = a.get("value_type")
        typed = f" ({value_type})" if value_type else ""
        row = f"  - {a['variable']}{typed} {a['operator']}"
        if a["operator"] not in UNARY_OPERATORS:
            row += f" {a.get('reference_value')!r}"
        log_fn(row)
        if "actual_value" in detail:
            log_fn(f"    actual: {_actual_text(detail['actual_value'])}")
    elif assertion_type == "expression":
        log_fn(f"  - Expression: {a['expression']}")


def _declared_assertion_count(assertions: list[Any]) -> int:
    """Assertion items the author wrote, excluding the AND/OR operators."""
    return sum(
        1 for item in assertions if isinstance(item, dict) and item.get("type") != "operator"
    )


def _log_assertion_failures(
    summary: str,
    failed_details: list[dict[str, Any]],
    logger: Any,
    fail_current_scope: bool,
) -> None:
    """Log assertion failure details at the appropriate level."""
    if not logger:
        return

    log_fn = logger.error if fail_current_scope else logger.warn
    log_fn(summary)
    for detail in failed_details:
        _log_single_failure(detail, log_fn)


def _build_failure_output(fail_current_scope: bool, mode: str) -> dict[str, Any]:
    """Build the output dict for a failed assertion that does not stop the flow."""
    out: dict[str, Any] = {"passed": False}
    if fail_current_scope:
        out["__scope_failed"] = True
    if mode == "split":
        out["__branch"] = "fail"
    return out


class AssertControl(ControlBase):
    """
    Assert validation control.

    Evaluates a list of typed assertions (literal, expression, or group)
    against a variable context and returns pass/fail with optional branching.
    Supports single mode (one output handle) and split mode (pass/fail handles).
    """

    CONTROL_ID = ControlId.ASSERT
    CONTROL_VERSION = "1.0.0"
    CONTROL_NAME = "Assert"
    CONTROL_CATEGORY = "conditional"

    @property
    def metadata(self) -> dict[str, Any]:
        """Return Assert control metadata."""
        return {
            "id": self.CONTROL_ID,
            "version": self.CONTROL_VERSION,
            "name": self.CONTROL_NAME,
            "description": "Validation assertion that fails if condition is false",
            "category": self.CONTROL_CATEGORY,
            "icon_name": "check-circle",
            "parameter_schema": [
                ControlParameter(
                    name="assertions",
                    type="array",
                    required=True,
                    description="Interleaved list of assertion and operator items",
                ),
                ControlParameter(
                    name="mode",
                    type="string",
                    required=True,
                    default="split",
                    description="Output mode: 'single' (one handle) or 'split' (pass/fail handles)",
                    enum_values=["single", "split"],
                ),
                ControlParameter(
                    name="fail_current_scope",
                    type="boolean",
                    required=False,
                    default=False,
                    description=(
                        "When true, a failed assertion in single mode fails the block and "
                        "stops the flow; in split mode the flow continues down the fail "
                        "branch and the Test or Function it runs in ends failed"
                    ),
                ),
            ],
            "output_schema": [
                {"name": "passed", "type": "boolean"},
            ],
            "structure_hints": {
                "type": "branching",
                "branches": ["pass", "fail"],
            },
        }

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Execute Assert validation.

        Evaluates assertions against the variable context. Exceptions from
        the evaluator (KeyError, TypeError, ValueError, etc.) propagate
        to the caller - they are not caught here.
        """
        params = context["parameters"]
        variables = context["variables"]
        logger = context.get("logger")

        assertions = params["assertions"]
        mode = params["mode"]
        fail_current_scope = params["fail_current_scope"]

        result = evaluate_assertions(assertions, variables)

        if result.passed:
            if logger:
                logger.info("All assertions passed")
            if mode == "split":
                return {"passed": True, "__branch": "pass"}
            return {"passed": True}

        failed_details = [d for d in result.details if not d["passed"]]
        # AND-segments short-circuit, so `details` holds only what was evaluated;
        # the summary names every assertion declared.
        summary = (
            f"Assertion failed: {len(failed_details)} of "
            f"{_declared_assertion_count(assertions)} assertions failed"
        )
        _log_assertion_failures(summary, failed_details, logger, fail_current_scope)
        if fail_current_scope and mode == "single":
            # A block failure: the walker paints it failed and its flow stops.
            raise AssertionError(summary)
        return _build_failure_output(fail_current_scope, mode)

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate Assert parameters."""
        if "assertions" not in params:
            raise ValueError("assertions parameter is required")
        assertions = params["assertions"]
        if not isinstance(assertions, list):
            raise ValueError("assertions must be a list")
        if len(assertions) == 0:
            raise ValueError("assertions must not be empty")
        raise_first_problem(condition_join_problems(assertions, "assertions"))
