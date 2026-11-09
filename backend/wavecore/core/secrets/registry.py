"""Per-run secret registry (REQ-3.1.3.5, REQ-4.5.3)."""

import json
from collections.abc import Hashable
from typing import Any

from wavecore.core.variables.print_form import value_text

# Minimum length for an INCIDENTAL sub-value (a leaf/str-form discovered inside a
# secret container) to be value-scrubbed. A directly-registered secret is scrubbed
# at any non-empty length regardless of this floor.
SCAN_VALUE_FLOOR = 6


class SecretRegistry:
    """Flat per-run registry of secret variable names and secret value byte-forms."""

    def __init__(self) -> None:
        self._names: set[str] = set()
        self._scan: set[str] = set()
        self._plain: set[str] = set()
        self._block_exempt: dict[str, set[str]] = {}
        self._held_names: dict[Hashable, set[str]] = {}
        self._held_forms: dict[Hashable, set[str]] = {}
        self.sources: dict[str, str] = {}

    def mark_name(self, name: str) -> None:
        """Flag a variable name secret for this run."""
        self._names.add(name)

    def is_secret_name(self, name: str) -> bool:
        """Check whether a variable name is flagged secret for this run or held secret now."""
        return name in self._names or any(name in names for names in self._held_names.values())

    def hold_name(self, holder: Hashable, name: str) -> None:
        """Flag a name secret until ``holder`` releases it (a Function call's secret output)."""
        self._held_names.setdefault(holder, set()).add(name)

    def release(self, holder: Hashable) -> None:
        """Drop the names and values ``holder`` holds; a value registered for the run stays."""
        self._held_names.pop(holder, None)
        self._held_forms.pop(holder, None)

    def register_written(self, name: str, value: Any, source: str) -> None:
        """A value written to a secret name: kept for the run, or held with the name's holder."""
        if name in self._names:
            self.register(name, value, source)
            return
        # The latest holder of a name is the innermost Function call writing it.
        for holder, names in reversed(self._held_names.items()):
            if name in names:
                self._held_forms.setdefault(holder, set()).update(self._string_forms(value))
                return

    def register(self, name: str, value: Any, source: str) -> None:
        """Flag the name and register the value's string forms for scrubbing."""
        self._names.add(name)
        self.sources[name] = source
        self._extract(value)

    def register_value(self, value: Any, source: str, exempt_block: str | None = None) -> None:
        """Register a value's string forms without flagging any name.

        ``exempt_block`` keeps the forms visible in that one block's own
        display lines (block-scoped per-field reveal); every other surface
        still scrubs them.
        """
        _ = source
        forms = self._string_forms(value)
        self._scan |= forms
        if exempt_block is not None:
            self._block_exempt.setdefault(exempt_block, set()).update(forms)
        else:
            self._plain |= forms

    def scan_values(self, exclude_for_block: str | None = None) -> tuple[str, ...]:
        """Registered string forms, longest first, for text scrubbing.

        ``exclude_for_block`` omits that block's exempted forms - unless the
        same bytes were also registered unexempted (protection wins).
        """
        held = set().union(*self._held_forms.values())
        values = self._scan | held
        exempt = self._block_exempt.get(exclude_for_block) if exclude_for_block else None
        if exempt:
            values = values - (exempt - self._plain - held)
        return tuple(sorted(values, key=lambda value: (-len(value), value)))

    def _extract(self, value: Any) -> None:
        forms = self._string_forms(value)
        self._scan |= forms
        self._plain |= forms

    def _string_forms(self, value: Any) -> set[str]:
        forms: set[str] = set()
        self._collect_forms(value, forms, top_level=True)
        return forms

    def _collect_forms(self, value: Any, forms: set[str], top_level: bool = False) -> None:
        if isinstance(value, bool) or value is None:
            return
        items = _container_items(value)
        if items is not None:
            # An empty container holds nothing to hide: its forms would mask every empty one.
            if not items:
                return
            # A secret container masks whole: its str(), print and fill forms (REQ-3.1.3.23).
            self._add_scan_form(str(value), forms)
            self._add_scan_form(value_text(value), forms)
            self._add_scan_form(_template_fill_text(value), forms)
            for item in items:
                self._collect_forms(item, forms)
            return
        # A directly-registered secret scrubs at any non-empty length; incidental
        # sub-values keep the floor so a secret container's short leaves (0, -1)
        # don't mask every occurrence in the logs.
        floor = 1 if top_level else SCAN_VALUE_FLOOR
        if isinstance(value, str):
            # A string embedded in a repr'd container escapes its special chars,
            # with the ENCLOSING string's quote delimiter (which may differ from
            # the secret's own); register both quote contexts plus the raw form.
            self._add_scan_form(value, forms, floor)
            self._add_scan_form(_repr_inner(value, "'"), forms, floor)
            self._add_scan_form(_repr_inner(value, '"'), forms, floor)
            # JSON text, such as WAVE's print form, writes control characters as \b or \u0001.
            self._add_scan_form(json.dumps(value, ensure_ascii=False)[1:-1], forms, floor)
            return
        self._add_scan_form(str(value), forms, floor)

    @staticmethod
    def _add_scan_form(text: str, forms: set[str], floor: int = SCAN_VALUE_FLOOR) -> None:
        if len(text) >= floor:
            forms.add(text)


def _container_items(value: Any) -> list[Any] | None:
    """The values under a list, map or table; None for anything else."""
    # core/table.py imports the secrets package, so Table is imported at call time.
    from wavecore.core.table import Table

    if isinstance(value, dict):
        return list(value.values())
    if isinstance(value, list | tuple):
        return list(value)
    if isinstance(value, Table):
        return [cell for row in value.to_list() for cell in row.values()]
    return None


def _template_fill_text(value: Any) -> str:
    """The text a DQL or JSON template fills in for ``value`` (REQ-3.3.2.6)."""
    # The template fill imports core/table, which imports the secrets package.
    from wavecore.core.expressions.template_escape import text_form

    return text_form(value)


def _repr_inner(value: str, quote: str) -> str:
    """``value`` escaped as it appears inside a ``quote``-delimited Python string
    literal. Reuses ``repr`` for the escaping and flips the delimiter when the
    two differ (the enclosing container may pick either quote)."""
    rendered = repr(value)
    chosen, inner = rendered[0], rendered[1:-1]
    if chosen == quote:
        return inner
    return inner.replace("\\" + chosen, chosen).replace(quote, "\\" + quote)
