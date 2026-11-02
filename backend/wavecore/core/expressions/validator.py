"""
Expression Validator using Python AST

Provides accurate expression validation by parsing Python code with the ast module.
This properly handles:
- List/dict/set comprehensions (loop variables are local)
- Generator expressions
- Lambda expressions
- Nested scopes

Used by the frontend for real-time validation feedback.
"""

import ast
import re
from dataclasses import dataclass
from typing import Any

from wavecore.core.expressions.security import (
    BLOCKED_FUNCTION_NAMES,
    BLOCKED_SUBSTRINGS,
    FIELD_BLOCKED_CONSTRUCTORS,
    MUTATING_METHOD_NAMES,
    SAFE_BUILTINS,
)


@dataclass
class ValidationIssue:
    """A validation issue found in an expression."""

    type: str  # 'error' or 'warning'
    code: str  # Machine-readable code: 'syntax_error', 'undefined_variable', 'blocked_pattern'
    message: str  # Human-readable message
    line: int  # 1-based line number (within the expression)
    column: int  # 0-based column number
    end_line: int | None = None
    end_column: int | None = None


@dataclass
class ValidationResult:
    """Result of expression validation."""

    valid: bool
    issues: list[ValidationIssue]

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "valid": self.valid,
            "issues": [
                {
                    "type": issue.type,
                    "code": issue.code,
                    "message": issue.message,
                    "line": issue.line,
                    "column": issue.column,
                    "end_line": issue.end_line,
                    "end_column": issue.end_column,
                }
                for issue in self.issues
            ],
        }


class NameCollector(ast.NodeVisitor):
    """
    AST visitor that collects all referenced names, respecting scopes.

    Handles:
    - Simple name references
    - Comprehension loop variables (local to comprehension)
    - Lambda parameters (local to lambda)
    - Nested comprehensions and lambdas
    """

    def __init__(self) -> None:
        self.referenced_names: set[str] = set()
        self.local_scopes: list[set[str]] = []  # Stack of local scopes

    def _is_local(self, name: str) -> bool:
        """Check if a name is defined in any local scope."""
        for scope in self.local_scopes:
            if name in scope:
                return True
        return False

    def _push_scope(self) -> set[str]:
        """Push a new local scope."""
        scope: set[str] = set()
        self.local_scopes.append(scope)
        return scope

    def _pop_scope(self) -> None:
        """Pop the current local scope."""
        self.local_scopes.pop()

    def visit_Name(self, node: ast.Name) -> None:
        """Visit a name reference."""
        if isinstance(node.ctx, ast.Load):
            # Only care about names being read, not written
            if not self._is_local(node.id):
                self.referenced_names.add(node.id)
        self.generic_visit(node)

    def visit_ListComp(self, node: ast.ListComp) -> None:
        """Visit a list comprehension - creates a new scope."""
        self._visit_comprehension(node.generators, node.elt)

    def visit_SetComp(self, node: ast.SetComp) -> None:
        """Visit a set comprehension - creates a new scope."""
        self._visit_comprehension(node.generators, node.elt)

    def visit_GeneratorExp(self, node: ast.GeneratorExp) -> None:
        """Visit a generator expression - creates a new scope."""
        self._visit_comprehension(node.generators, node.elt)

    def visit_DictComp(self, node: ast.DictComp) -> None:
        """Visit a dict comprehension - creates a new scope."""
        scope = self._push_scope()

        # Process generators in order (each can reference previous loop vars)
        for generator in node.generators:
            # First visit the iterable (before adding loop var to scope)
            self.visit(generator.iter)

            # Add loop variable(s) to scope
            self._add_target_to_scope(generator.target, scope)

            # Visit conditions (can use loop var)
            for if_clause in generator.ifs:
                self.visit(if_clause)

        # Visit key and value expressions
        self.visit(node.key)
        self.visit(node.value)

        self._pop_scope()

    def visit_Lambda(self, node: ast.Lambda) -> None:
        """Visit a lambda expression - creates a new scope for parameters."""
        scope = self._push_scope()

        # Add parameters to local scope
        for arg in node.args.args:
            scope.add(arg.arg)
        for arg in node.args.posonlyargs:
            scope.add(arg.arg)
        for arg in node.args.kwonlyargs:
            scope.add(arg.arg)
        if node.args.vararg:
            scope.add(node.args.vararg.arg)
        if node.args.kwarg:
            scope.add(node.args.kwarg.arg)

        # Visit the lambda body
        self.visit(node.body)

        self._pop_scope()

    def _visit_comprehension(self, generators: list[ast.comprehension], element: ast.expr) -> None:
        """Common logic for list/set/generator comprehensions."""
        scope = self._push_scope()

        # Process generators in order (each can reference previous loop vars)
        for generator in generators:
            # First visit the iterable (before adding loop var to scope)
            self.visit(generator.iter)

            # Add loop variable(s) to scope
            self._add_target_to_scope(generator.target, scope)

            # Visit conditions (can use loop var)
            for if_clause in generator.ifs:
                self.visit(if_clause)

        # Visit the element expression
        self.visit(element)

        self._pop_scope()

    def _add_target_to_scope(self, target: ast.expr, scope: set[str]) -> None:
        """Add assignment target(s) to scope. Handles tuple unpacking."""
        if isinstance(target, ast.Name):
            scope.add(target.id)
        elif isinstance(target, ast.Tuple | ast.List):
            for elt in target.elts:
                self._add_target_to_scope(elt, scope)


def _check_statement_patterns(expression: str) -> ValidationIssue | None:
    """Check for statement patterns that are not valid in expressions."""
    # Check for walrus operator := (assignment expression)
    # Valid Python 3.8+ syntax but not allowed in our expressions
    walrus_match = re.search(r":=", expression)
    if walrus_match:
        return ValidationIssue(
            type="error",
            code="statement_not_allowed",
            message="Assignment expressions (:=) not allowed - use Variable Setter",
            line=1,
            column=walrus_match.start(),
            end_column=walrus_match.end(),
        )

    # Check for assignment = at the start of expression (top-level assignment)
    # Pattern: expression starts with identifier = (but not ==)
    # This catches: x = 1, foo = "bar", inc = inc + 1
    # But allows: x == 1, sorted(data, key=lambda x: x) (keyword arg)
    assign_match = re.match(r"^[a-zA-Z_]\w*\s*=(?!=)", expression.strip())
    if assign_match:
        return ValidationIssue(
            type="error",
            code="statement_not_allowed",
            message="Assignment statements not allowed - use Variable Setter",
            line=1,
            column=0,
            end_column=assign_match.end(),
        )

    return None


def _check_blocked_patterns(expression: str) -> ValidationIssue | None:
    """Check for blocked patterns in the expression."""
    lower_expr = expression.lower()

    # Check substring patterns (dangerous in any context)
    for pattern in BLOCKED_SUBSTRINGS:
        if pattern in lower_expr:
            pos = lower_expr.find(pattern)
            return ValidationIssue(
                type="error",
                code="blocked_pattern",
                message=f"Blocked pattern '{pattern}' - not allowed for security reasons",
                line=1,
                column=pos,
                end_column=pos + len(pattern),
            )

    # Check function names (blocked as function calls)
    for name in BLOCKED_FUNCTION_NAMES:
        # Match function call pattern: name followed by (
        match = re.search(rf"\b{name}\s*\(", lower_expr)
        if match:
            return ValidationIssue(
                type="error",
                code="blocked_pattern",
                message=f"Blocked function '{name}' - not allowed for security reasons",
                line=1,
                column=match.start(),
                end_column=match.end(),
            )

    return None


class MutationDetector(ast.NodeVisitor):
    """
    AST visitor that detects mutating method calls and mutable constructors.

    Used in field expression context where mutations are not allowed.
    Detects:
    - Mutating method calls: x.append(1), x.sort(), x.clear(), etc.
    - Mutable constructors: list(), dict(), set()
    """

    def __init__(self) -> None:
        self.issues: list[ValidationIssue] = []

    def visit_Call(self, node: ast.Call) -> None:
        """Visit function/method calls to detect mutations."""
        # Check for mutating method calls: obj.method(...)
        if isinstance(node.func, ast.Attribute):
            method_name = node.func.attr
            if method_name in MUTATING_METHOD_NAMES:
                self.issues.append(
                    ValidationIssue(
                        type="error",
                        code="mutation_not_allowed",
                        message=(
                            f"Method '{method_name}' modifies data and is not "
                            f"allowed in field expressions"
                        ),
                        line=node.func.end_lineno or node.func.lineno,
                        column=node.func.col_offset,
                        end_column=node.func.end_col_offset,
                    )
                )
        # Check for mutable constructors: list(), dict(), set()
        elif isinstance(node.func, ast.Name):
            if node.func.id in FIELD_BLOCKED_CONSTRUCTORS:
                self.issues.append(
                    ValidationIssue(
                        type="error",
                        code="mutation_not_allowed",
                        message=(
                            f"Function '{node.func.id}' creates mutable data and is "
                            f"not allowed in field expressions"
                        ),
                        line=node.func.end_lineno or node.func.lineno,
                        column=node.func.col_offset,
                        end_column=node.func.end_col_offset,
                    )
                )
        self.generic_visit(node)


def _check_field_mutations(tree: ast.AST) -> list[ValidationIssue]:
    """Check for mutating operations in a field expression AST.

    Args:
        tree: Parsed AST of the expression

    Returns:
        List of mutation-related validation issues
    """
    detector = MutationDetector()
    detector.visit(tree)
    return detector.issues


def validate_expression(
    expression: str,
    available_variables: set[str] | None = None,
    *,
    is_field_expression: bool = False,
) -> ValidationResult:
    """
    Validate a raw Python expression.

    Args:
        expression: The Python expression to validate
        available_variables: Set of available variable names. If None, skip variable checking.
        is_field_expression: If True, block mutating methods and mutable constructors
            (read-only field context where expressions cannot modify variables).

    Returns:
        ValidationResult with valid flag and list of issues
    """
    issues: list[ValidationIssue] = []

    # Check for statement patterns first (assignments, walrus operator)
    statement_issue = _check_statement_patterns(expression)
    if statement_issue:
        issues.append(statement_issue)
        return ValidationResult(valid=False, issues=issues)

    # Check for blocked patterns (security)
    blocked_issue = _check_blocked_patterns(expression)
    if blocked_issue:
        issues.append(blocked_issue)
        return ValidationResult(valid=False, issues=issues)

    # Try to parse as Python expression
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as e:
        issues.append(
            ValidationIssue(
                type="error",
                code="syntax_error",
                message=f"Invalid Python syntax: {e.msg}",
                line=e.lineno or 1,
                column=e.offset - 1 if e.offset else 0,
            )
        )
        return ValidationResult(valid=False, issues=issues)

    # Check for mutations in field expressions (read-only context)
    if is_field_expression:
        mutation_issues = _check_field_mutations(tree)
        if mutation_issues:
            issues.extend(mutation_issues)
            return ValidationResult(valid=False, issues=issues)

    # Collect all referenced names
    collector = NameCollector()
    collector.visit(tree)

    # Check for undefined variables
    if available_variables is not None:
        # Names that are allowed: available variables + safe builtins
        allowed_names = available_variables | set(SAFE_BUILTINS.keys())

        for name in collector.referenced_names:
            if name not in allowed_names:
                issues.append(
                    ValidationIssue(
                        type="warning",
                        code="undefined_variable",
                        message=f"Variable '{name}' is not defined",
                        line=1,
                        column=0,  # We don't have precise position from collector
                    )
                )

    return ValidationResult(valid=len([i for i in issues if i.type == "error"]) == 0, issues=issues)
