"""`:name` placeholders and the binds each driver takes (REQ-3.4.1.6 SQL-2)."""

import re
from typing import Any, NamedTuple

from wavecore.connectivity.sql._split import CODE, OTHER, lex


class Placeholder(NamedTuple):
    name: str
    start: int
    end: int


_NAME = re.compile(r"[A-Za-z_]\w*", re.ASCII)
_ORACLE_TRIGGER = re.compile(
    r"CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:EDITIONABLE|NONEDITIONABLE)\s+)?TRIGGER\b",
    re.IGNORECASE,
)
# Row references inside an Oracle trigger body, never binds.
_TRIGGER_ROWS = frozenset({"new", "old"})
_NAMED_TYPES = frozenset({"oracle", "sqlite"})


def placeholders(dialect: str, statement: str) -> list[Placeholder]:
    """Every `:name` outside quotes, quoted names and comments, in statement order."""
    found: list[Placeholder] = []
    head: int | None = None
    for kind, start, end in lex(dialect, statement):
        if head is None and kind in CODE:
            head = start
        if kind != OTHER or statement[start] != ":" or statement[start - 1 : start] == ":":
            continue
        name = _NAME.match(statement, end)
        in_trigger = dialect == "oracle" and _ORACLE_TRIGGER.match(statement, head or 0)
        if name and not (in_trigger and name.group().lower() in _TRIGGER_ROWS):
            found.append(Placeholder(name.group(), start, name.end()))
    return found


def bind_params(dialect: str, statement: str, params: dict[str, Any]) -> tuple[str, Any]:
    """The statement in the driver's placeholder form and its binds; None when it names none."""
    found = placeholders(dialect, statement)
    for placeholder in found:
        if placeholder.name not in params:
            raise ValueError(f"Parameter '{placeholder.name}' is used in the SQL but not defined")
    if not found:
        return statement, None
    if dialect in _NAMED_TYPES:
        return statement, {p.name: params[p.name] for p in found}
    numbers: dict[str, int] = {}
    pieces: list[str] = []
    last = 0
    for placeholder in found:
        between = statement[last : placeholder.start]
        if dialect == "postgresql":
            number = numbers.setdefault(placeholder.name, len(numbers) + 1)
            pieces += [between, f"${number}"]
        else:
            pieces += [between.replace("%", "%%"), "%s"]
        last = placeholder.end
    tail = statement[last:]
    pieces.append(tail if dialect == "postgresql" else tail.replace("%", "%%"))
    names = list(numbers) if dialect == "postgresql" else [p.name for p in found]
    return "".join(pieces), tuple(params[name] for name in names)
