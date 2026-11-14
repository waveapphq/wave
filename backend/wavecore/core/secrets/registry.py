"""Per-run secret registry (REQ-3.1.3.5, REQ-4.5.3)."""

import json
import math
from collections.abc import Hashable, Iterable, Iterator
from dataclasses import dataclass, field
from decimal import Decimal
from hashlib import blake2b
from typing import TYPE_CHECKING, Any, NamedTuple, Self, cast

from wavecore.core.number_rule import plain_number_text
from wavecore.core.variables.decimal_value import decimal_to_str
from wavecore.core.variables.print_form import value_text

if TYPE_CHECKING:
    from wavecore.core.table import Table

# Minimum length for an INCIDENTAL sub-value (a leaf/str-form discovered inside a
# secret container) to be value-scrubbed. A directly-registered secret is scrubbed
# at any non-empty length regardless of this floor.
SCAN_VALUE_FLOOR = 6

# How deep masking walks a value. A secret list, map or table nested deeper than this
# registers no digest, since no masking pass could compare it.
MAX_DEPTH = 100

# A list, map or table form's shape: a list's size and the digest of how its first item starts,
# a map's size and the digest of its keys, or a table's rows and columns.
Facts = tuple[str, int, int]

# How much of a text a list's first item digest reads.
_LEAD_TEXT = 16

# The kind of value a list's first item is, kept in the two low bits of its digest.
_TEXT_LEAD, _BARE_LEAD, _MAP_LEAD, _LIST_LEAD = range(4)

# The kind of a list's first item by its exact type, known without reading its digest; a first
# item of any other type has its digest read.
_LEAD_KINDS: dict[type, int] = {
    str: _TEXT_LEAD,
    int: _BARE_LEAD,
    float: _BARE_LEAD,
    bool: _BARE_LEAD,
    Decimal: _BARE_LEAD,
    type(None): _BARE_LEAD,
    dict: _MAP_LEAD,
    list: _LIST_LEAD,
    tuple: _LIST_LEAD,
}

# What a value writes inside a list, map or table: the same text in its print form and its
# fill form, or the two in turn (a float in exponent notation, a table, anything holding one).
Piece = str | tuple[str, str]


class ListLeads(NamedTuple):
    """How the secret lists of one size start: the first item types none starts with, and the
    digests of their first items."""

    skipped: frozenset[type]
    digests: frozenset[int]

    @classmethod
    def of(cls, digests: Iterable[int]) -> "ListLeads":
        found = frozenset(digests)
        kinds = {lead & 3 for lead in found}
        skipped = frozenset(
            kind_type for kind_type, kind in _LEAD_KINDS.items() if kind not in kinds
        )
        return cls(skipped, found)

    def started_by(self, item: Any) -> bool:
        """Whether a list whose first item is ``item`` starts like one of these secret lists."""
        lead = lead_digest(item)
        if isinstance(lead, int):
            return lead in self.digests
        return not self.digests.isdisjoint(lead)


class ContainerDigest(NamedTuple):
    """How a secret list, map or table is recognized: its shape and a digest, none of its text."""

    facts: Facts
    digest: str


class ScanValues(tuple[str, ...]):
    """Registered forms, longest first, with the digests of the secret lists, maps and tables."""

    container_digests: frozenset[str]
    container_facts: frozenset[Facts]
    list_leads: dict[int, ListLeads]
    map_sizes: frozenset[int]
    map_keys: frozenset[int]

    def __new__(cls, values: Iterable[str] = (), digests: Iterable[ContainerDigest] = ()) -> Self:
        scan = super().__new__(cls, values)
        kept = tuple(digests)
        scan.container_digests = frozenset(entry.digest for entry in kept)
        scan.container_facts = frozenset(entry.facts for entry in kept)
        leads: dict[int, set[int]] = {}
        for facts in scan.container_facts:
            if facts[0] == "[":
                leads.setdefault(facts[1], set()).add(facts[2])
        # Each secret list's size, with how its first item starts.
        scan.list_leads = {size: ListLeads.of(found) for size, found in leads.items()}
        # A table prints as a map of two entries, its columns and its rows.
        scan.map_sizes = frozenset(
            2 if facts[0] == "T" else facts[1] for facts in scan.container_facts if facts[0] != "["
        )
        scan.map_keys = frozenset(
            _TABLE_KEYS if facts[0] == "T" else facts[2]
            for facts in scan.container_facts
            if facts[0] != "["
        )
        return scan

    def copies(self, piece: Piece) -> bool:
        """Whether a value whose piece this is prints or fills in as a secret container does."""
        if isinstance(piece, str):
            return piece in self.container_digests
        return piece[0] in self.container_digests or piece[1] in self.container_digests


@dataclass
class _Marks:
    """What registrations leave: the text forms that scrub and the digests that recognize."""

    forms: set[str] = field(default_factory=set)
    digests: set[ContainerDigest] = field(default_factory=set)

    def update(self, other: "_Marks") -> None:
        self.forms |= other.forms
        self.digests |= other.digests


class SecretRegistry:
    """Flat per-run registry of secret variable names and secret value byte-forms."""

    def __init__(self) -> None:
        self._names: set[str] = set()
        self._scan = _Marks()
        self._plain = _Marks()
        self._block_exempt: dict[str, _Marks] = {}
        self._held_names: dict[Hashable, set[str]] = {}
        self._held: dict[Hashable, _Marks] = {}
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
        """Drop the names, values and digests ``holder`` holds; what the run registered stays."""
        self._held_names.pop(holder, None)
        self._held.pop(holder, None)

    def register_written(self, name: str, value: Any, source: str) -> None:
        """A value written to a secret name: kept for the run, or held with the name's holder."""
        if name in self._names:
            self.register(name, value, source)
            return
        # The latest holder of a name is the innermost Function call writing it.
        for holder, names in reversed(self._held_names.items()):
            if name in names:
                self._held.setdefault(holder, _Marks()).update(_marks_of(value))
                return

    def register(self, name: str, value: Any, source: str) -> None:
        """Flag the name and register the value's string forms for scrubbing."""
        self._names.add(name)
        self.sources[name] = source
        marks = _marks_of(value)
        self._scan.update(marks)
        self._plain.update(marks)

    def register_value(self, value: Any, source: str, exempt_block: str | None = None) -> None:
        """Register a value's string forms without flagging any name.

        ``exempt_block`` keeps the forms visible in that one block's own
        display lines (block-scoped per-field reveal); every other surface
        still scrubs them.
        """
        _ = source
        marks = _marks_of(value)
        self._scan.update(marks)
        if exempt_block is not None:
            self._block_exempt.setdefault(exempt_block, _Marks()).update(marks)
        else:
            self._plain.update(marks)

    def scan_values(self, exclude_for_block: str | None = None) -> ScanValues:
        """Registered string forms, longest first, for text scrubbing.

        ``exclude_for_block`` omits that block's exempted forms - unless the
        same bytes were also registered unexempted (protection wins).
        """
        held = _Marks()
        for marks in self._held.values():
            held.update(marks)
        values = self._scan.forms | held.forms
        digests = self._scan.digests | held.digests
        exempt = self._block_exempt.get(exclude_for_block) if exclude_for_block else None
        if exempt:
            values = values - (exempt.forms - self._plain.forms - held.forms)
            digests = digests - (exempt.digests - self._plain.digests - held.digests)
        return ScanValues(sorted(values, key=lambda value: (-len(value), value)), digests)


def _marks_of(value: Any) -> _Marks:
    """A secret value's text forms and, for each list, map or table in it, its digests."""
    marks = _Marks()
    if isinstance(value, dict | list | tuple | table_type()):
        _ContainerMarks(marks).collect(value)
    else:
        # A directly-registered secret scrubs at any non-empty length.
        _add_leaf_forms(value, marks.forms, floor=1)
    return marks


class _Open:
    """A list or map the registration walk is inside, with what its items wrote so far."""

    __slots__ = ("value", "entries", "pieces", "height", "printable")

    def __init__(self, value: Any, entries: list[tuple[Any, Any]]) -> None:
        self.value = value
        self.entries = entries
        self.pieces: list[Piece] | None = []
        self.height = 1
        # Whether its text forms can be written past the cap: only through plain lists and maps.
        self.printable = True


class _ContainerMarks:
    """One registration walk: no recursion, so a secret of any depth registers."""

    def __init__(self, marks: _Marks) -> None:
        self._marks = marks
        self._table = table_type()

    def collect(self, value: Any) -> None:
        entries = _branch_entries(value)
        if entries is None:
            self._flat(value)
            return
        stack = [_Open(value, entries)]
        while stack:
            current = stack[-1]
            if not current.entries:
                stack.pop()
                piece = self._close(current)
                if stack:
                    _join(stack[-1], piece, current.height, current.printable)
                elif piece is None and current.printable:
                    # No pass compares a secret taller than the cap, but text still prints it whole.
                    self._text(_tall_forms(value))
                continue
            key, item = current.entries.pop()
            if current.pieces is not None and key is not _NO_KEY:
                # A map writes each key before its item.
                current.pieces.append(key_piece(key))
            entries = _branch_entries(item)
            if entries is None:
                _join(current, *self._flat(item))
            else:
                stack.append(_Open(item, entries))

    def _flat(self, item: Any) -> tuple[Piece, int]:
        """An item with no list or map in it: a table or a single value."""
        if isinstance(item, self._table):
            piece = table_piece(item)
            if item.row_count() and item.col_count():
                rows, columns = item.row_count(), item.col_count()
                # A table fills in as its rows, a list of maps with its column names as keys.
                first_row = dict.fromkeys(item.col_names())
                fill_facts = [("[", rows, lead) for lead in _leads(lead_digest(first_row))]
                self._whole(item, piece, [("T", rows, columns)], fill_facts)
                for row in item:
                    for cell in row:
                        _add_leaf_forms(cell, self._marks.forms, SCAN_VALUE_FLOOR)
            return piece, 1
        _add_leaf_forms(item, self._marks.forms, SCAN_VALUE_FLOOR)
        return leaf_piece(item), 0

    def _close(self, current: _Open) -> Piece | None:
        if current.pieces is None:
            if type(current.value) not in (list, dict):
                current.printable = False
            return None
        value = current.value
        piece = branch_piece(value, current.pieces)
        if value:
            facts = branch_facts(value)
            self._whole(value, piece, facts, facts)
        return piece

    def _whole(
        self,
        value: Any,
        piece: Piece,
        print_facts: list[Facts],
        fill_facts: list[Facts],
    ) -> None:
        """A secret container masks whole: its forms scrub text and its digests copies."""
        self._text(_whole_forms(value))
        for facts in print_facts:
            self._marks.digests.add(ContainerDigest(facts, _print_piece(piece)))
        for facts in fill_facts:
            self._marks.digests.add(ContainerDigest(facts, _fill_piece(piece)))

    def _text(self, forms: Iterable[str]) -> None:
        for form in forms:
            _add_scan_form(form, self._marks.forms)


# A list item has no key; a map item's key is written before it.
_NO_KEY = object()


def _join(current: _Open, piece: Piece | None, height: int, printable: bool = True) -> None:
    """Add an item's piece to the list or map around it; past the depth cap none is kept."""
    current.height = max(current.height, height + 1)
    current.printable = current.printable and printable
    if current.pieces is None:
        return
    if piece is None or current.height > MAX_DEPTH:
        current.pieces = None
        return
    current.pieces.append(piece)


def _branch_entries(value: Any) -> list[tuple[Any, Any]] | None:
    """A list's or map's items with their keys, last first; None for anything else."""
    if isinstance(value, dict):
        return list(reversed(value.items()))
    if isinstance(value, list | tuple):
        return [(_NO_KEY, item) for item in reversed(value)]
    return None


def _add_leaf_forms(value: Any, forms: set[str], floor: int) -> None:
    """A single value's text forms; a secret container's short leaves (0, -1) keep the floor."""
    if isinstance(value, bool) or value is None:
        return
    if isinstance(value, str):
        # A string embedded in a repr'd container escapes its special chars,
        # with the ENCLOSING string's quote delimiter (which may differ from
        # the secret's own); register both quote contexts plus the raw form.
        _add_scan_form(value, forms, floor)
        _add_scan_form(_repr_inner(value, "'"), forms, floor)
        _add_scan_form(_repr_inner(value, '"'), forms, floor)
        # JSON text, such as WAVE's print form, writes control characters as \b or \u0001.
        _add_scan_form(json.dumps(value, ensure_ascii=False)[1:-1], forms, floor)
        return
    _add_scan_form(str(value), forms, floor)


def _add_scan_form(text: str, forms: set[str], floor: int = SCAN_VALUE_FLOOR) -> None:
    if len(text) >= floor:
        forms.add(text)


def _whole_forms(value: Any) -> Iterator[str]:
    """A secret container's str(), print and fill forms, in turn."""
    yield str(value)
    yield value_text(value)
    yield _template_fill_text(value)


class _Parts(NamedTuple):
    """What a value writes into a container's str(), print and fill forms."""

    shown: str
    printed: str
    filled: str


_MAP_OPEN = _Parts("{", "{", "{")
_MAP_CLOSE = _Parts("}", "}", "}")
_LIST_OPEN = _Parts("[", "[", "[")
_LIST_CLOSE = _Parts("]", "]", "]")
_ITEM_GAP = _Parts(", ", ",", ",")


def _tall_forms(value: Any) -> tuple[str, str, str]:
    """A list's or map's str(), print and fill forms, written without recursion at any depth."""
    written: list[_Parts] = []
    todo: list[Any] = [value]
    while todo:
        item = todo.pop()
        if type(item) is _Parts:
            written.append(item)
        elif type(item) is dict:
            entries = list(item.items())
            todo.append(_MAP_CLOSE)
            for index in range(len(entries) - 1, -1, -1):
                key, child = entries[index]
                todo += (child, _key_parts(key, index))
            todo.append(_MAP_OPEN)
        elif type(item) is list:
            todo.append(_LIST_CLOSE)
            # Every item but the first follows a gap.
            for index in range(len(item) - 1, 0, -1):
                todo.append(item[index])
                todo.append(_ITEM_GAP)
            if item:
                todo.append(item[0])
            todo.append(_LIST_OPEN)
        else:
            # Anything else sits within the cap, so the encoders write it, as a list item.
            single = [item]
            written.append(
                _Parts(repr(item), value_text(single)[1:-1], _template_fill_text(single)[1:-1])
            )
    shown, printed, filled = ("".join(parts) for parts in zip(*written, strict=True))
    return shown, printed, filled


def _key_parts(key: Any, index: int) -> _Parts:
    """A map key as each form writes it, after the gap to the entry before it."""
    shown_gap, gap = (", ", ",") if index else ("", "")
    text = json.dumps(str(key), ensure_ascii=False)
    return _Parts(f"{shown_gap}{key!r}: ", f"{gap}{text}:", f"{gap}{text}:")


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


def table_type() -> "type[Table]":
    # core/table.py imports the secrets package, so Table is imported at call time.
    from wavecore.core.table import Table

    return Table


# Two values share a digest exactly when their print forms or fill forms match (REQ-3.1.3.5).
def _seal_items(head: str, pieces: list[Piece]) -> Piece:
    """A list's or map's digest from its items' pieces, in each form when an item's two differ."""
    if tuple not in map(type, pieces):
        return _seal(head, cast(list[str], pieces))
    printed = _seal(head, [_print_piece(piece) for piece in pieces])
    return printed, _seal(head, [_fill_piece(piece) for piece in pieces])


def _seal(head: str, pieces: list[str]) -> str:
    """The fixed-size digest of one list or map form, from its shape and its items' pieces."""
    text = head + "".join(pieces)
    return "d" + blake2b(text.encode("utf-8", "surrogatepass"), digest_size=16).hexdigest()


def _head(value: Any) -> str:
    # A tuple travels as a list, so it takes a list's shape and digest.
    bracket = "{" if isinstance(value, dict) else "["
    return f"{bracket}{len(value)}|"


def branch_piece(value: Any, pieces: list[Piece]) -> Piece:
    """A list's, map's or tuple's piece, from the pieces its items wrote in order."""
    return _seal_items(_head(value), pieces)


def branch_facts(value: Any) -> list[Facts]:
    """The shapes a list, map or tuple shows; a map of columns and rows shows a table's too."""
    if isinstance(value, dict):
        return map_facts(value)
    return [("[", len(value), lead) for lead in _leads(lead_digest(value[0]))]


def lead_digest(item: Any) -> int | tuple[int, int]:
    """A fixed-size digest of how a list's first item starts, its kind in the low bits; a table
    gives one for each form."""
    if isinstance(item, str):
        return hash(item[:_LEAD_TEXT]) << 2 | _TEXT_LEAD
    if isinstance(item, int | float | Decimal):
        # Numbers that write the same text in either form have the same nearest float.
        try:
            nearest = float(item)
        except (OverflowError, ValueError):
            return _SPECIAL_LEAD
        return hash(nearest) << 2 | _BARE_LEAD if math.isfinite(nearest) else _SPECIAL_LEAD
    if isinstance(item, dict):
        return hash((len(item), key_digest(item))) << 2 | _MAP_LEAD
    if isinstance(item, list | tuple):
        return len(item) << 2 | _LIST_LEAD
    if item is None:
        return _SPECIAL_LEAD
    if isinstance(item, table_type()):
        # A table prints as a map of its columns and rows and fills in as its rows.
        return _TABLE_LEAD, item.row_count() << 2 | _LIST_LEAD
    # Anything else both forms write as its str() text.
    return hash(str(item)[:_LEAD_TEXT]) << 2 | _TEXT_LEAD


def _leads(lead: int | tuple[int, int]) -> tuple[int, ...]:
    return (lead,) if isinstance(lead, int) else lead


def key_digest(value: dict[Any, Any]) -> int:
    """A fixed-size digest of a map's keys as both forms write them, in any order."""
    return hash(frozenset(map(str, value)))


def map_facts(value: dict[Any, Any]) -> list[Facts]:
    """A map's size and the digest of its keys; a map of columns and rows shows a table's too."""
    keys = key_digest(value)
    facts: Facts = ("{", len(value), keys)
    if keys == _TABLE_KEYS and len(value) == 2:
        (first, columns), (_, rows) = value.items()
        if str(first) == "columns" and (
            isinstance(columns, list | tuple) and isinstance(rows, list | tuple)
        ):
            return [facts, ("T", len(rows), len(columns))]
    return [facts]


_TABLE_KEYS = key_digest(dict.fromkeys(("columns", "rows")))
# A table starts a list the way a map of its columns and rows does.
_TABLE_LEAD = hash((2, _TABLE_KEYS)) << 2 | _MAP_LEAD
# Null, a number too large for a float, infinity and NaN share one digest.
_SPECIAL_LEAD = _BARE_LEAD


def key_piece(key: Any) -> str:
    """A map key as both forms write it: its text."""
    text = str(key)
    return f"k{len(text)}:{text}"


def leaf_piece(value: Any) -> Piece:
    """A single value inside a list, map or table, as the print form and the fill form write it."""
    if isinstance(value, str):
        return _leaf_text(value)
    if value is None:
        return _bare("null")
    if isinstance(value, bool):
        return _bare("true" if value else "false")
    if isinstance(value, int):
        return _bare(int.__repr__(value))
    if isinstance(value, Decimal):
        return _bare(decimal_to_str(value))
    if isinstance(value, float):
        if not math.isfinite(value):
            return _bare(json.dumps(value))
        printed = plain_number_text(value)
        filled = float.__repr__(value)
        if printed == filled:
            return _bare(printed)
        return _bare(printed), _bare(filled)
    # Anything else both forms write as its str() text, in quotes.
    return _leaf_text(str(value))


def _leaf_text(text: str) -> str:
    """A text value's piece, the same in both forms."""
    return f"s{len(text)}:{text}"


def _bare(text: str) -> str:
    return f"b{len(text)}:{text}"


def table_piece(table: "Table") -> tuple[str, str]:
    """A table prints as its columns and rows and fills in as its rows, one map per row."""
    names = table.col_names()
    columns = [
        _seal("{2|", [key_piece("name"), _leaf_text(name), key_piece("type"), _leaf_text(kind)])
        for name, kind in zip(names, table.col_types(), strict=True)
    ]
    printed_rows: list[str] = []
    filled_rows: list[str] = []
    for view, mapping in zip(table, table.to_list(), strict=True):
        cells = view.to_list()
        printed_rows.append(
            _seal(f"[{len(cells)}|", [_print_piece(leaf_piece(cell)) for cell in cells])
        )
        filled: list[str] = []
        for name, cell in mapping.items():
            filled += (key_piece(name), _fill_piece(leaf_piece(cell)))
        filled_rows.append(_seal(f"{{{len(mapping)}|", filled))
    printed = [
        key_piece("columns"),
        _seal(f"[{len(names)}|", columns),
        key_piece("rows"),
        _seal(f"[{len(printed_rows)}|", printed_rows),
    ]
    return _seal("{2|", printed), _seal(f"[{len(filled_rows)}|", filled_rows)


def _print_piece(piece: Piece) -> str:
    return piece if isinstance(piece, str) else piece[0]


def _fill_piece(piece: Piece) -> str:
    return piece if isinstance(piece, str) else piece[1]
