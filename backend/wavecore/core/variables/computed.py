"""The free variable names of an expression (REQ-3.1.3.13)."""

import ast
from functools import lru_cache


@lru_cache(maxsize=1)
def _provided_names() -> frozenset[str]:
    """The names the run's expression sandbox provides, so none reads as a variable."""
    from wavecore.core.expressions.security import SAFE_BUILTINS

    return frozenset(SAFE_BUILTINS)


def extract_expression_names(expression: str) -> set[str]:
    """Extract the free variable names of a Python expression.

    Names bound by a comprehension or a lambda are local to it, never
    references, so the shared scope-aware collector does the walking.
    """
    from wavecore.core.expressions.validator import NameCollector

    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError:
        return set()
    collector = NameCollector()
    collector.visit(tree)
    return collector.referenced_names - _provided_names()
