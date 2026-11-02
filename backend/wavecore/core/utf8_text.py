"""Finds text that UTF-8 cannot write, in raw text and in parsed data (REQ-4.6.9)."""

import json
import math
import re
from decimal import Decimal
from typing import Any

import yaml

from wavecore.core.variables.decimal_value import WaveDecimal, decimal_to_str

# How JSON and YAML escape a surrogate.
_ESCAPES = r"\\u[dD][89a-fA-F]|\\U0000[dD][89a-fA-F]"
_FORMS_IN_BYTES = re.compile(_ESCAPES.encode() + rb"|\xed[\xa0-\xbf]")
_FORMS_IN_TEXT = re.compile(_ESCAPES + "|[\ud800-\udfff]")
_SURROGATE = re.compile("[\ud800-\udfff]")
_PAIR = re.compile("([\ud800-\udbff])([\udc00-\udfff])")

_Path = str | None
# re.ASCII: only the digits 0-9, never another script's digits.
_PLAIN_INTEGER = re.compile(r"-?\d+", re.ASCII)
_PLAIN_FLOAT = re.compile(r"-?\d+\.\d+", re.ASCII)
_INT_TAG = "tag:yaml.org,2002:int"
_FLOAT_TAG = "tag:yaml.org,2002:float"


def may_hold_unencodable(raw: bytes | str) -> bool:
    """False for raw text that needs no walk: it has no form of a surrogate in it."""
    if isinstance(raw, str):
        return _FORMS_IN_TEXT.search(raw) is not None
    if _FORMS_IN_BYTES.search(raw):
        return True
    return not json.detect_encoding(raw).startswith("utf-8")


def unencodable_place(raw: bytes | str, document: Any, whole: str) -> str | None:
    """Where `document`, parsed from `raw`, first holds text UTF-8 cannot write."""
    if not may_hold_unencodable(raw):
        return None
    return first_unencodable(document, whole)


def first_unencodable(document: Any, whole: str) -> str | None:
    """Where the first text UTF-8 cannot write sits, in document order; `whole` names the root."""
    pending: list[tuple[_Path, Any]] = [(None, document)]
    while pending:
        path, value = pending.pop()
        if not isinstance(value, str):
            pending.extend(reversed(_children(path, value)))
        elif _SURROGATE.search(value):
            return whole if path is None else path
    return None


def _children(path: _Path, value: Any) -> list[tuple[_Path, Any]]:
    """A container's keys and values in document order, each with the path it is shown under."""
    if isinstance(value, dict):
        return [pair for key, child in value.items() for pair in _entry(path, key, child)]
    if isinstance(value, list | tuple):
        return [(f"{path or ''}[{index}]", child) for index, child in enumerate(value)]
    if isinstance(value, set):
        return [pair for key in sorted(value, key=str) for pair in _entry(path, key, None)]
    return []


def _entry(path: _Path, key: Any, child: Any) -> list[tuple[_Path, Any]]:
    """A key, then its value; a character of the key that cannot be written shows as `?`."""
    prefix = "" if path is None else f"{path}."
    shown = str(key)
    return [(prefix + _SURROGATE.sub("?", shown), key), (prefix + shown, child)]


def _joined(pair: re.Match[str]) -> str:
    high, low = ord(pair[1]) - 0xD800, ord(pair[2]) - 0xDC00
    return chr(0x10000 + (high << 10) + low)


class _Loader(yaml.SafeLoader):
    """SafeLoader that reads the two escapes of one character as that character, as JSON does."""

    def construct_text(self, node: yaml.ScalarNode) -> str:
        return _PAIR.sub(_joined, self.construct_scalar(node))


_Loader.add_constructor("tag:yaml.org,2002:str", _Loader.construct_text)


def load_yaml(text: bytes | str) -> Any:
    """What yaml.safe_load gives, with a character written as two escapes read as one."""
    return _Loader(text).get_single_data()


class _ExactLoader(_Loader):
    """Only plain decimal numbers are numbers, read exactly; any other number form stays text."""

    def construct_exact_int(self, node: yaml.ScalarNode) -> int | str:
        text = self.construct_scalar(node)
        return int(text) if _PLAIN_INTEGER.fullmatch(text) else text

    def construct_exact_float(self, node: yaml.ScalarNode) -> WaveDecimal | str:
        text = self.construct_scalar(node)
        return WaveDecimal(text) if _PLAIN_FLOAT.fullmatch(text) else text


_ExactLoader.add_constructor(_INT_TAG, _ExactLoader.construct_exact_int)
_ExactLoader.add_constructor(_FLOAT_TAG, _ExactLoader.construct_exact_float)


def load_exact_yaml(text: bytes | str) -> Any:
    """What ``load_yaml`` gives, numbers aside: a plain decimal integer is an ``int``, a plain
    decimal float a ``WaveDecimal`` with every digit, and every other number form is its text."""
    return _ExactLoader(text).get_single_data()


def _plain_float(number: Decimal) -> str:
    text = decimal_to_str(number)
    return text if "." in text else f"{text}.0"


class _ExactDumper(yaml.SafeDumper):
    """Writes every finite number in plain digits, so ``load_exact_yaml`` reads it back."""

    def represent_plain_float(self, data: float) -> yaml.ScalarNode:
        if not math.isfinite(data):
            return self.represent_float(data)
        return self.represent_scalar(_FLOAT_TAG, _plain_float(Decimal(repr(data))))

    def represent_decimal(self, data: Decimal) -> yaml.ScalarNode:
        if not data.is_finite():
            return self.represent_str(str(data))
        return self.represent_scalar(_FLOAT_TAG, _plain_float(data))


_ExactDumper.add_representer(float, _ExactDumper.represent_plain_float)
_ExactDumper.add_multi_representer(Decimal, _ExactDumper.represent_decimal)


def dump_exact_yaml(document: Any) -> str:
    """A document as recipe YAML: keys in order, Unicode as written, numbers in plain digits."""
    return yaml.dump(document, Dumper=_ExactDumper, sort_keys=False, allow_unicode=True)
