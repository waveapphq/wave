"""Declared variable types published for the duration of a run (REQ-3.1.3.6)."""

from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any

from wavecore.core.functions.declarations import is_enum_input

_DEFAULT_TYPE = "string"
_NO_TYPES: Mapping[str, str] = {}

_declared_types: ContextVar[Mapping[str, str]] = ContextVar("wave_declared_types")


@contextmanager
def declared_type_scope(types: Mapping[str, str]) -> Iterator[None]:
    """Replace the declared-type map for the duration of a run or a Function body."""
    token = _declared_types.set(dict(types))
    try:
        yield
    finally:
        _declared_types.reset(token)


def declared_type(name: str) -> str | None:
    return _declared_types.get(_NO_TYPES).get(name)


def _entry_type(entry: Mapping[str, Any]) -> str:
    return str(entry.get("type") or _DEFAULT_TYPE)


def types_of_declarations(raw_variables: Mapping[str, Any]) -> dict[str, str]:
    """The declared type of each dict-form entry; a bare value declares nothing."""
    return {
        name: _entry_type(entry)
        for name, entry in raw_variables.items()
        if isinstance(entry, Mapping)
    }


def types_of_function(
    function_def: Mapping[str, Any], *, every_input: bool = False
) -> dict[str, str]:
    """Declared types of inputs, body variables and outputs; an output wins a shared name."""
    inputs = [
        entry
        for entry in function_def.get("inputs") or []
        if isinstance(entry, Mapping) and (every_input or is_enum_input(entry))
    ]
    entries = [
        *inputs,
        *(function_def.get("variables") or []),
        *(function_def.get("outputs") or []),
    ]
    return {
        str(entry["name"]): _entry_type(entry)
        for entry in entries
        if isinstance(entry, Mapping) and entry.get("name")
    }
