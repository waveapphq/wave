"""Secret masking primitives (REQ-3.1.3.5, REQ-4.5.3).

Two mechanisms share one canonical placeholder: value-scrub of registered
secret byte-forms in outbound text, and flag-based full-opacity masking of
variable displays (no keys, no shape, no counts).
"""

from collections.abc import Callable, Iterator, Mapping, Sequence
from typing import Any, cast

from wavecore.core.secrets.registry import (
    MAX_DEPTH,
    Piece,
    ScanValues,
    SecretRegistry,
    branch_piece,
    key_digest,
    key_piece,
    leaf_piece,
    map_facts,
    table_piece,
    table_type,
)

MASK_PLACEHOLDER = "********"


def holds_secret_value(value: Any) -> bool:
    """Whether a secret slot holds a value: None and "" hold nothing, whitespace is a value."""
    return value is not None and not (isinstance(value, str) and value == "")


def is_unfilled_secret(declaration: Any) -> bool:
    """A declaration flagged secret whose value holds nothing: a person still owes it."""
    return (
        isinstance(declaration, dict)
        and bool(declaration.get("secret"))
        and not holds_secret_value(declaration.get("value"))
    )


def mask_text(text: str, scan_values: Sequence[str]) -> str:
    """Replace every occurrence of each registered value, longest first."""
    # A registry's scan values come longest first already.
    if not isinstance(scan_values, ScanValues):
        scan_values = sorted(scan_values, key=len, reverse=True)
    for value in scan_values:
        text = text.replace(value, MASK_PLACEHOLDER)
    return text


def mask_values(value: Any, scan_values: Sequence[str]) -> Any:
    """Value counterpart of ``mask_text``: recursively scrub registered secret
    byte-forms from a str / list / dict, with no name-flag masking."""
    return _mask_content(value, _scan_of(scan_values))


def structural_mask(value: Any) -> Any:
    """The one masking step: a held value, whatever its shape, shows as the bare placeholder."""
    return MASK_PLACEHOLDER if holds_secret_value(value) else value


def masked_declaration(
    declaration: Mapping[str, Any], *, flag_masked: bool = False
) -> dict[str, Any]:
    """A secret declaration as a read shows it: a held value masked, its element types gone."""
    if not holds_secret_value(declaration.get("value")):
        return dict(declaration)
    masked = {key: item for key, item in declaration.items() if key != "elementTypes"}
    masked["value"] = structural_mask(declaration["value"])
    if flag_masked:
        masked["masked"] = True
    return masked


def mask_with_metadata(value: Any) -> dict[str, Any]:
    """Mask a value while exposing structure/length metadata only (never keys)."""
    metadata: dict[str, Any] = {}
    if isinstance(value, str):
        metadata["length"] = len(value)
    elif isinstance(value, list):
        metadata = {"type": "array", "size": len(value)}
    elif isinstance(value, dict):
        metadata = {"type": "map", "size": len(value)}
    return {"value": structural_mask(value), "metadata": metadata}


def mask_structure(obj: Any, registry: SecretRegistry) -> Any:
    """Mask a variables-shaped mapping: flagged names collapse, copies mask by value."""
    scan = registry.scan_values()
    if not isinstance(obj, dict):
        return _mask_content(obj, scan)
    return {
        name: (
            structural_mask(value) if registry.is_secret_name(name) else _mask_content(value, scan)
        )
        for name, value in obj.items()
    }


def mask_wire_structure(variables: Mapping[str, Any], registry: SecretRegistry) -> dict[str, Any]:
    """``mask_structure`` for a stored run: each value masked, then in its wire form."""
    scan = registry.scan_values()
    return {
        name: (
            structural_mask(value)
            if registry.is_secret_name(name)
            else mask_wire_values(value, scan)
        )
        for name, value in variables.items()
    }


def mask_wire_values(value: Any, scan_values: Sequence[str]) -> Any:
    """An unflagged value in its wire form, a table as columns and rows, masked by value."""
    # wire_form imports core/table, which imports this module, so it is imported at call time.
    from wavecore.core.variables.wire_form import wire_values

    return _mask_content(value, _scan_of(scan_values), wire_values)


def _scan_of(scan_values: Sequence[str]) -> ScanValues:
    """Only a registry's scan values know its secret lists, maps and tables."""
    if isinstance(scan_values, ScanValues):
        return scan_values
    return ScanValues(sorted(scan_values, key=len, reverse=True))


def _mask_content(
    value: Any, scan_values: ScanValues, wire_form: Callable[[Any], Any] | None = None
) -> Any:
    """A copy of a secret list, map or table collapses whole; other values scrub leaf by leaf."""
    if not scan_values.container_digests:
        return _scrub(value, scan_values, wire_form)
    return _ContentMask(scan_values, wire_form).visit(value, 0)


def _scrub(
    value: Any,
    scan_values: tuple[str, ...],
    wire_form: Callable[[Any], Any] | None,
    depth: int = 0,
) -> Any:
    """The pass when the run holds no secret container: one call per value, none per leaf."""
    if depth >= MAX_DEPTH:
        return _scrub_deep(value if wire_form is None else wire_form(value), scan_values)
    if isinstance(value, str):
        return mask_text(value, scan_values)
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, dict):
        return {key: _scrub(item, scan_values, wire_form, depth + 1) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_scrub(item, scan_values, wire_form, depth + 1) for item in value]
    if wire_form is not None:
        return _scrub_leaves(wire_form(value), scan_values)
    return MASK_PLACEHOLDER if str(value) in scan_values else value


class _ContentMask:
    """One masking pass to the depth cap, comparing a value whole where its shape is a secret's."""

    def __init__(self, scan_values: ScanValues, wire_form: Callable[[Any], Any] | None) -> None:
        self._scan = scan_values
        self._wire_form = wire_form
        self._facts = scan_values.container_facts
        self._list_leads = scan_values.list_leads
        self._leads_of_size = scan_values.list_leads.get
        self._map_sizes = scan_values.map_sizes
        self._map_keys = scan_values.map_keys
        self._table = table_type()

    def visit(self, value: Any, depth: int) -> Any:
        """The masked value; a list or map shaped like no secret container is never digested."""
        if depth >= MAX_DEPTH:
            return self._past_the_cap(value)
        if isinstance(value, str):
            return mask_text(value, self._scan)
        if isinstance(value, bool) or value is None:
            return value
        if isinstance(value, dict):
            if (
                len(value) in self._map_sizes
                and key_digest(value) in self._map_keys
                and not self._facts.isdisjoint(map_facts(value))
            ):
                return self._compared(value, depth)[0]
            visit, child = self.visit, depth + 1
            return {key: visit(item, child) for key, item in value.items()}
        if isinstance(value, list | tuple):
            leads = self._leads_of_size(len(value))
            # A first item of a type no secret list of this size starts with skips the digest.
            if (
                leads is not None
                and type(value[0]) not in leads.skipped
                and leads.started_by(value[0])
            ):
                return self._compared(value, depth)[0]
            visit, child = self.visit, depth + 1
            return [visit(item, child) for item in value]
        if isinstance(value, self._table):
            return self._table_value(value, needed=False)[0]
        if self._wire_form is not None:
            return _scrub_leaves(self._wire_form(value), self._scan)
        return MASK_PLACEHOLDER if str(value) in self._scan else value

    def _compared(self, value: Any, depth: int) -> tuple[Any, Piece | None]:
        """A list or map, compared whole once its items gave their pieces on the way back up."""
        pieces: list[Piece | None] = []
        masked: Any
        if isinstance(value, dict):
            masked = {}
            for key, item in value.items():
                masked[key], piece = self._with_piece(item, depth + 1)
                pieces += (key_piece(key), piece)
        else:
            masked = []
            for item in value:
                masked_item, piece = self._with_piece(item, depth + 1)
                masked.append(masked_item)
                pieces.append(piece)
        # An item past the depth cap leaves the value around it uncompared.
        if None in pieces:
            return masked, None
        whole = branch_piece(value, cast(list[Piece], pieces))
        return (MASK_PLACEHOLDER if self._scan.copies(whole) else masked), whole

    def _with_piece(self, value: Any, depth: int) -> tuple[Any, Piece | None]:
        """The masked value, and the piece the list or map around it compares."""
        if depth >= MAX_DEPTH:
            # Past the cap only the leaves scrub: a list or map there is never compared.
            if isinstance(value, dict | list | tuple):
                return self._past_the_cap(value), None
            return self._past_the_cap(value), self._flat_piece(value)
        if isinstance(value, str):
            return mask_text(value, self._scan), leaf_piece(value)
        if isinstance(value, bool) or value is None:
            return value, leaf_piece(value)
        if isinstance(value, dict | list | tuple):
            return self._compared(value, depth)
        if isinstance(value, self._table):
            return self._table_value(value, needed=True)
        return self.visit(value, depth), leaf_piece(value)

    def _written(self, value: Any) -> Any:
        """A value as this pass writes it: as it is, or in its wire form."""
        return value if self._wire_form is None else self._wire_form(value)

    def _past_the_cap(self, value: Any) -> Any:
        return _scrub_deep(self._written(value), self._scan)

    def _table_value(self, value: Any, needed: bool) -> tuple[Any, Piece | None]:
        rows, columns = value.row_count(), value.col_count()
        piece = None
        if needed or rows in self._list_leads or ("T", rows, columns) in self._facts:
            piece = table_piece(value)
            # A table with no cells holds nothing to copy.
            if rows and columns and self._scan.copies(piece):
                return MASK_PLACEHOLDER, piece
        # A table keeps its shape: only its names and cells scrub, never a row or column whole.
        return _scrub_leaves(self._written(value), self._scan), piece

    def _flat_piece(self, value: Any) -> Piece:
        return table_piece(value) if isinstance(value, self._table) else leaf_piece(value)


def _scrub_leaves(value: Any, scan_values: tuple[str, ...]) -> Any:
    """A table's or a single value's written form, every name, text and cell scrubbed."""
    if isinstance(value, str):
        return mask_text(value, scan_values)
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, dict):
        return {key: _scrub_leaves(item, scan_values) for key, item in value.items()}
    if isinstance(value, list):
        return [_scrub_leaves(item, scan_values) for item in value]
    if str(value) in scan_values:
        return MASK_PLACEHOLDER
    return value


def _scrub_deep(value: Any, scan_values: tuple[str, ...]) -> Any:
    """A value past the depth cap, every leaf scrubbed at any depth, a tuple as a list: a stack,
    not recursion."""
    if not isinstance(value, dict | list | tuple):
        return _scrub_leaves(value, scan_values)
    top = _open_copy(value)
    frames = [top]
    while frames:
        copy, entries = frames[-1]
        for slot, item in entries:
            if isinstance(item, dict | list | tuple):
                frame = _open_copy(item)
                copy[slot] = frame[0]
                frames.append(frame)
                break
            copy[slot] = _scrub_leaves(item, scan_values)
        else:
            frames.pop()
    return top[0]


def _open_copy(value: Any) -> tuple[Any, Iterator[tuple[Any, Any]]]:
    """An empty copy of a list or map to fill, and the entries left to fill it with."""
    if isinstance(value, dict):
        return {}, iter(value.items())
    return [None] * len(value), enumerate(value)


def secret_param_names(plugin_metadata: Mapping[str, Any]) -> set[str]:
    """Names of secret-declared input parameters in a plugin's metadata.

    Plugin ``parameters`` are declared as dicts (the parameter model carries no
    secret flag), so only the dict form can mark a param secret."""
    return {
        param["name"]
        for param in plugin_metadata.get("parameters") or []
        if isinstance(param, dict) and param.get("secret")
    }


def mask_io_payload(
    payload: dict[str, Any], secret_keys: set[str], sub_key_catalog: set[str]
) -> dict[str, Any]:
    """Declaration-driven mask of an engine harness I/O map.

    A key in ``secret_keys`` collapses its whole value to the placeholder;
    inside a dict value, entries whose lowercased key is in ``sub_key_catalog``
    collapse individually while siblings pass through. Returns a display copy;
    the input is never mutated.
    """
    result: dict[str, Any] = {}
    for key, value in payload.items():
        if key in secret_keys:
            result[key] = structural_mask(value)
        elif isinstance(value, dict) and sub_key_catalog:
            result[key] = {
                sub_key: (
                    structural_mask(sub_value) if sub_key.lower() in sub_key_catalog else sub_value
                )
                for sub_key, sub_value in value.items()
            }
        else:
            result[key] = value
    return result
