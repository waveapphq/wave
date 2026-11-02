"""Lazy computed workbench variables (REQ-3.1.3.13); not a dict, so eval() calls __getitem__."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator, MutableMapping
from typing import TYPE_CHECKING, Any, cast

from wavecore.core.variables.usage import closed_loop, cycle_message

if TYPE_CHECKING:
    from wavecore.core.secrets.registry import SecretRegistry


class LazyVariables(MutableMapping[str, Any]):
    """A ``MutableMapping`` that lazily evaluates expression variables.

    Behaves like a plain ``dict[str, Any]`` for read / write / iterate /
    contains, except expression variables (declared with
    ``isExpression=True``) stay pending until something looks them up.
    Iteration and ``len()`` only count realized entries, which keeps
    snapshots, JSON serialization, and diff-based pushes from
    triggering evaluation as a side effect.
    """

    def __init__(
        self,
        initial: dict[str, Any] | None = None,
        *,
        expr_map: dict[str, tuple[str, str]] | None = None,
        tmpl_map: dict[str, str] | None = None,
        on_evaluated: Callable[[str, Any], None] | None = None,
        secret_registry: SecretRegistry | None = None,
        evaluated: dict[str, Any] | None = None,
    ) -> None:
        """Initialize the wrapper.

        Args:
            initial: Literal values to seed the realized storage with.
            expr_map: Map of variable name to (expression, type) for
                pending expression variables. Each entry is removed
                when the expression is evaluated.
            tmpl_map: Map of variable name to template source for pending
                template variables. Each entry is removed when the
                template is rendered. A template renders to a string by
                substituting its ``{{ }}`` markers (REQ-3.1.3.15).
            on_evaluated: Optional callback fired exactly once per
                expression / template when it is first realized, with the
                variable name and the evaluated value.
            secret_registry: Optional per-run SecretRegistry; values written
                to or realized for secret-flagged names register for
                run-wide masking (REQ-3.1.3.5).
            evaluated: The source each evaluated result among ``initial`` came
                from: (expression, type) or a template source (REQ-3.2.1.5).
        """
        self._data: dict[str, Any] = dict(initial) if initial else {}
        self._expr_map: dict[str, tuple[str, str]] = dict(expr_map) if expr_map else {}
        self._tmpl_map: dict[str, str] = dict(tmpl_map) if tmpl_map else {}
        self._evaluating: list[str] = []
        self._written: set[str] = set()
        self._evaluated: dict[str, Any] = dict(evaluated) if evaluated else {}
        self._stale: set[str] = set()
        self._given_sources: dict[str, tuple[str, str] | str] = {}
        self._on_evaluated = on_evaluated
        self._secret_registry = secret_registry

    # ------------------------------------------------------------------
    # MutableMapping core
    # ------------------------------------------------------------------

    def __getitem__(self, key: str) -> Any:
        if key in self._data:
            return self._data[key]
        if key in self._expr_map:
            return self._evaluate(key)
        if key in self._tmpl_map:
            return self._evaluate_template_var(key)
        raise KeyError(key)

    def __setitem__(self, key: str, value: Any) -> None:
        # A direct assignment supersedes any pending expression / template for
        # the same name. Eg. a Var Setter writing to a name that the test also
        # declared as a computed variable replaces the computed value.
        self._expr_map.pop(key, None)
        self._tmpl_map.pop(key, None)
        self._forget_result(key)
        self._given_sources.pop(key, None)
        self._data[key] = value
        self._written.add(key)
        self._register_if_secret(key, value, "write")

    def __delitem__(self, key: str) -> None:
        self._expr_map.pop(key, None)
        self._tmpl_map.pop(key, None)
        self._given_sources.pop(key, None)
        self._written.discard(key)
        self._forget_result(key)
        del self._data[key]

    def __iter__(self) -> Iterator[str]:
        # Iteration intentionally exposes only realized entries. Pending
        # expressions are reachable through ``pending_expression_names``
        # but do not appear in ``items()`` / ``keys()`` / ``values()`` /
        # ``len`` because the workbench treats those calls as snapshots
        # of state (push diffs, serialization, history).
        return iter(self._data)

    def __len__(self) -> int:
        return len(self._data)

    def __contains__(self, key: object) -> bool:
        if not isinstance(key, str):
            return False
        return key in self._data or key in self._expr_map or key in self._tmpl_map

    # ------------------------------------------------------------------
    # Convenience
    # ------------------------------------------------------------------

    def copy(self) -> dict[str, Any]:
        """Return a plain-dict snapshot of realized entries.

        Pending expressions are NOT realized by this call. Callers that
        want a "before" snapshot for diff comparison get the realized
        state at the time of the call; pending expressions that get
        realized later will appear as new entries in the diff.
        """
        return dict(self._data)

    def pending_expression_names(self) -> Iterable[str]:
        """Names of expressions that have not yet been realized."""
        return iter(self._expr_map)

    def written_names(self) -> frozenset[str]:
        """Names assigned since the store was built and still holding that value (REQ-3.2.1.5)."""
        return frozenset(self._written)

    def evaluated_sources(self) -> dict[str, Any]:
        """The source of each evaluated result still held: (expression, type) or a template."""
        return dict(self._evaluated)

    def mark_stale(self, names: Iterable[str]) -> None:
        """Note the evaluated results among ``names`` as due again at the next ad-hoc run."""
        self._stale.update(name for name in names if name in self._evaluated)

    def stale_names(self) -> frozenset[str]:
        """The evaluated results marked as due again and still held (REQ-3.2.1.5)."""
        return frozenset(self._stale)

    def _forget_result(self, key: str) -> None:
        self._evaluated.pop(key, None)
        self._stale.discard(key)

    def setdefault(self, key: str, default: Any = None) -> Any:
        """Seed ``key`` with its default when nothing holds it; a default is not a write."""
        if key in self:
            return self[key]
        self._data[key] = default
        return default

    def given(self) -> LazyVariables:
        """A new store of only the written names and Current-edit sources (REQ-3.2.1.5)."""
        written = {name: value for name, value in self._data.items() if name in self._written}
        kept = LazyVariables(written)
        kept._written = set(written)
        for name, source in self._given_sources.items():
            kept.give_source(name, source)
        return kept

    def adopt(self, other: LazyVariables) -> None:
        """Take ``other``'s values as writes and its Current-edit sources."""
        self.update(other)
        for name, source in other._given_sources.items():
            self.give_source(name, source)

    def give_source(self, name: str, source: tuple[str, str] | str) -> None:
        """Re-arm ``name`` with the expression or template a Current-mode edit set (REQ-3.2.1.6)."""
        if isinstance(source, tuple):
            self.set_expression(name, *source)
        else:
            self.set_template(name, source)
        self._given_sources[name] = source

    def has_pending_expressions(self) -> bool:
        return bool(self._expr_map)

    def set_expression(self, name: str, source: str, var_type: str) -> None:
        """Re-arm ``name`` as a pending expression (inverse of the realize step).

        Repopulates the pending map and drops any realized value, so the next
        ``__getitem__`` re-evaluates the new source lazily.
        """
        self._expr_map[name] = (source, var_type)
        self._tmpl_map.pop(name, None)
        self._given_sources.pop(name, None)
        self._data.pop(name, None)
        self._written.discard(name)
        self._forget_result(name)

    def set_template(self, name: str, source: str) -> None:
        """Re-arm ``name`` as a pending template (inverse of the realize step).

        Repopulates the pending template map and drops any realized value (and
        any pending expression of the same name), so the next ``__getitem__``
        re-renders the new source lazily. Backs the Current-mode template
        override.
        """
        self._tmpl_map[name] = source
        self._expr_map.pop(name, None)
        self._given_sources.pop(name, None)
        self._data.pop(name, None)
        self._written.discard(name)
        self._forget_result(name)

    # ------------------------------------------------------------------
    # Evaluation
    # ------------------------------------------------------------------

    def _register_if_secret(self, name: str, value: Any, source: str) -> None:
        if self._secret_registry is not None:
            self._secret_registry.register_written(name, value, source)

    def _enter(self, name: str) -> None:
        """Note ``name`` as evaluating; reading it again inside its own evaluation is a loop."""
        if name in self._evaluating:
            loop = self._evaluating[self._evaluating.index(name) :]
            raise ValueError(cycle_message(closed_loop(loop)))
        self._evaluating.append(name)

    def _evaluate(self, name: str) -> Any:
        self._enter(name)
        try:
            from wavecore.core.execution.plugin_executor import (
                check_expression_type,
                evaluate_expression,
            )
            from wavecore.core.variables.element_types import realize_computed_value

            expression, var_type = self._expr_map[name]
            result = evaluate_expression(expression, self)
            check_expression_type(name, result, var_type)
            result = realize_computed_value(result, var_type)
            del self._expr_map[name]
            self._data[name] = result
            self._evaluated[name] = (expression, var_type)
            self._register_if_secret(name, result, "realized")
            if self._on_evaluated is not None:
                self._on_evaluated(name, result)
            return result
        finally:
            self._evaluating.pop()

    def _evaluate_template_var(self, name: str) -> str:
        self._enter(name)
        try:
            from wavecore.core.execution.plugin_executor import _evaluate_template

            source = self._tmpl_map[name]
            # ``self`` is a MutableMapping, not a dict; the cast is for the type
            # checker only - ``{{ }}`` marker lookups still route through
            # __getitem__ so referenced computed vars realize lazily.
            # A null piece names this variable as its setting (REQ-3.1.3.15).
            result = _evaluate_template(source, cast(dict[str, Any], self), setting=name)
            del self._tmpl_map[name]
            self._data[name] = result
            self._evaluated[name] = source
            self._register_if_secret(name, result, "realized")
            if self._on_evaluated is not None:
                self._on_evaluated(name, result)
            return result
        finally:
            self._evaluating.pop()
