"""Shell Script variable exports: the POSIX exit hook, its capture file, and type conversion."""

import json
import re
import shlex
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from wavecore.core.table_values import as_table
from wavecore.core.variables.decimal_value import to_wave_decimal

DOT_SOURCE = '. "$0"'

# Every probe that a shell may refuse runs in a subshell: a bad substitution is fatal
# to the whole shell, not just to the eval, and set -e stays live inside the trap.
_HOOK = r"""__wave_file=__WAVE_FILE__
__wave_write() {
  {
    for __wave_name in __WAVE_NAMES__; do
      __wave_probe="set -- \"\${$__wave_name[@]}\""
      __wave_attrs=$(set +u; eval "printf %s \"\${$__wave_name@a}\"" 2>/dev/null) || __wave_attrs=
      case $__wave_attrs in
        *A*) __wave_kind=A; eval "set -- \"\${!$__wave_name[@]}\"" ;;
        *a*) __wave_kind=a; eval "$__wave_probe" ;;
        *)
          set --
          (eval "$__wave_probe") 2>/dev/null && eval "$__wave_probe"
          case $# in
            0|1) eval "__wave_kind=\${$__wave_name+s}"; __wave_kind=${__wave_kind:-u} ;;
            *) __wave_kind=a ;;
          esac
          ;;
      esac
      case $__wave_kind in
        A)
          printf '%s\000A\000%s\000' "$__wave_name" "$#"
          for __wave_key in "$@"; do
            eval "__wave_value=\${$__wave_name[\"\$__wave_key\"]}"
            printf '%s\000%s\000' "$__wave_key" "$__wave_value"
          done
          ;;
        a)
          printf '%s\000a\000%s\000' "$__wave_name" "$#"
          case $# in 0) ;; *) printf '%s\000' "$@" ;; esac
          ;;
        s)
          eval "__wave_value=\$$__wave_name"
          printf '%s\000s\000%s\000' "$__wave_name" "$__wave_value"
          ;;
        u)
          printf '%s\000u\000' "$__wave_name"
          ;;
      esac
    done
    printf '\000e\000'
  } > "$__wave_file"
}
__wave_capture() {
  __wave_status=$?
  __wave_write
  exit "$__wave_status"
}
__wave_stop() {
  trap '' TERM
  trap - EXIT
  __wave_write
  exit 143
}
trap __wave_capture EXIT
trap __wave_stop TERM
. "$0"
"""

_NUL = b"\x00"
_END_KIND = b"e"
_INTEGER = re.compile(r"[+-]?\d+", re.ASCII)
_TRUE_WORDS = frozenset({"true", "1", "yes"})
_FALSE_WORDS = frozenset({"false", "0", "no"})
_SCALAR_TYPES = frozenset({"string", "integer", "float", "boolean"})
_STRUCTURED_DETAIL = {
    "array": "array: the value must use valid JSON array syntax",
    "map": "map: the value must use valid JSON object syntax",
    "table": "table: the value must use valid JSON array-of-objects syntax",
}


class CaptureError(ValueError):
    """A captured export cannot be read as the bound variable's type."""


@dataclass(frozen=True)
class Captured:
    """One captured export: kind "s" (scalar), "a" (list), "A" (map) or "u" (never set)."""

    kind: str
    scalar: str | None = None
    items: list[str] | None = None
    pairs: dict[str, str] | None = None


def build_preamble(names: list[str], capture_path: str) -> str:
    if not names:
        return DOT_SOURCE
    return _HOOK.replace("__WAVE_FILE__", shlex.quote(capture_path)).replace(
        "__WAVE_NAMES__", " ".join(names)
    )


def parse_capture(data: bytes) -> dict[str, Captured]:
    return _read(data)[0]


def hook_ran(data: bytes) -> bool:
    """True when the capture file ends with the hook's end marker."""
    return _read(data)[1]


def _text(raw: bytes) -> str:
    return raw.decode("utf-8", errors="replace")


def _read(data: bytes) -> tuple[dict[str, Captured], bool]:
    fields = data.split(_NUL)[:-1]
    exports: dict[str, Captured] = {}
    pos = 0
    while pos + 1 < len(fields):
        name, kind, payload = _text(fields[pos]), fields[pos + 1], fields[pos + 2 :]
        if kind == _END_KIND and not name:
            return exports, True
        entry = _entry(kind, payload)
        if entry is None:
            break
        captured, used = entry
        exports[name] = captured
        pos += 2 + used
    return exports, False


def _entry(kind: bytes, payload: list[bytes]) -> tuple[Captured, int] | None:
    """One export and the payload field count it used; None when the fields form no export."""
    if kind == b"u":
        return Captured(kind="u"), 0
    if kind == b"s" and payload:
        return Captured(kind="s", scalar=_text(payload[0])), 1
    if kind in (b"a", b"A") and payload and payload[0].isdigit():
        return _listed(kind, payload)
    return None


def _listed(kind: bytes, payload: list[bytes]) -> tuple[Captured, int] | None:
    width = int(payload[0]) * (1 if kind == b"a" else 2)
    texts = [_text(raw) for raw in payload[1 : 1 + width]]
    if len(texts) < width:
        return None
    if kind == b"a":
        return Captured(kind="a", items=texts), 1 + width
    pairs = dict(zip(texts[::2], texts[1::2], strict=True))
    return Captured(kind="A", pairs=pairs), 1 + width


def coerce(name: str, captured: Captured, declared_type: str | None) -> Any:
    if captured.kind == "u":
        return None
    if declared_type in _SCALAR_TYPES:
        return _scalar(name, captured, declared_type)
    if declared_type == "array":
        return _array(name, captured)
    if declared_type == "map":
        return _map(name, captured)
    if declared_type == "table":
        return _table(name, captured)
    return _raw(captured)


def _fail(name: str, detail: str) -> CaptureError:
    return CaptureError(f"Script variable '{name}' is not a valid {detail}")


def _raw(captured: Captured) -> Any:
    if captured.kind == "a":
        return captured.items
    if captured.kind == "A":
        return captured.pairs
    return captured.scalar


def _scalar(name: str, captured: Captured, declared_type: str) -> Any:
    if captured.kind != "s":
        raise _fail(name, declared_type)
    text = captured.scalar or ""
    if declared_type == "string":
        return text
    text = text.strip()
    if declared_type == "integer":
        if _INTEGER.fullmatch(text):
            return int(text)
    elif declared_type == "float":
        value = to_wave_decimal(text)
        if isinstance(value, Decimal) and value.is_finite():
            return value
    else:
        word = text.casefold()
        if word in _TRUE_WORDS:
            return True
        if word in _FALSE_WORDS:
            return False
    raise _fail(name, declared_type)


def _json(name: str, captured: Captured, declared_type: str) -> Any:
    try:
        return json.loads(captured.scalar or "", parse_float=Decimal)
    except ValueError:
        raise _fail(name, _STRUCTURED_DETAIL[declared_type]) from None


def _array(name: str, captured: Captured) -> Any:
    if captured.kind == "a":
        return captured.items
    if captured.kind == "s":
        value = _json(name, captured, "array")
        if isinstance(value, list):
            return value
    raise _fail(name, _STRUCTURED_DETAIL["array"])


def _map(name: str, captured: Captured) -> Any:
    if captured.kind == "A":
        return captured.pairs
    if captured.kind == "s":
        value = _json(name, captured, "map")
        if isinstance(value, dict):
            return value
    raise _fail(name, _STRUCTURED_DETAIL["map"])


def _rows_match(value: Any) -> bool:
    return (
        isinstance(value, list)
        and all(isinstance(row, dict) for row in value)
        and all(row.keys() == value[0].keys() for row in value)
    )


def _table(name: str, captured: Captured) -> Any:
    if captured.kind == "s":
        value = _json(name, captured, "table")
        if _rows_match(value):
            try:
                return as_table(value)
            except TypeError:
                pass
    raise _fail(name, _STRUCTURED_DETAIL["table"])
