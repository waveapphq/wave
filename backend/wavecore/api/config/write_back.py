"""Config write-back: a Save changes only its own keys in the config file (REQ-4.7.16)."""

import io
import os
import re
import stat
from collections.abc import Mapping, MutableMapping
from pathlib import Path
from typing import Any, Final

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq
from ruamel.yaml.constructor import RoundTripConstructor
from ruamel.yaml.error import CommentMark
from ruamel.yaml.representer import RoundTripRepresenter
from ruamel.yaml.tokens import CommentToken

from wavecore.api.config.loader import ConfigFileProblem, read_config_file
from wavecore.api.exceptions import InternalServerException

_NULL_TAG: Final[str] = "tag:yaml.org,2002:null"
_NESTED_KEY: Final = re.compile(r"^( +)[^\s#-]", re.MULTILINE)
_LIST_ITEM: Final = re.compile(r"^( *)- ", re.MULTILINE)
_COMMENT_OR_BLANK: Final = re.compile(r"\s*(#|$)")
# Where the parser keeps the comment that follows a list item and a mapping value.
_AFTER_ITEM: Final[int] = 0
_AFTER_VALUE: Final[int] = 2


class ConfigWriteError(InternalServerException):
    """A Save that could not change the config file; the message says why."""


class _Null:
    """A null of the file, kept as the file spells it."""

    def __init__(self, spelling: str) -> None:
        self.spelling = spelling


class _Constructor(RoundTripConstructor):
    def construct_null(self, node: Any) -> _Null:
        return _Null(node.value)


class _Representer(RoundTripRepresenter):
    def represent_none(self, data: Any) -> Any:
        return self.represent_scalar(_NULL_TAG, "null")

    def represent_null(self, data: _Null) -> Any:
        return self.represent_scalar(_NULL_TAG, data.spelling)


_Constructor.add_constructor(_NULL_TAG, _Constructor.construct_null)
_Representer.add_representer(type(None), _Representer.represent_none)
_Representer.add_representer(_Null, _Representer.represent_null)


class _LayoutKeepingParser(YAML):
    """Round-trip parser that writes a file back the way the file is laid out."""

    def __init__(self) -> None:
        super().__init__()
        self.Constructor = _Constructor
        self.Representer = _Representer
        self.preserve_quotes = True
        self.width = 4096

    def load(self, stream: Any) -> Any:
        document = super().load(stream)
        return None if isinstance(document, _Null) else document

    def follow(self, text: str) -> None:
        """Write with the indentation and the document start the text uses."""
        nested = _NESTED_KEY.search(text)
        mapping = len(nested.group(1)) if nested else 2
        offset = mapping
        item = _LIST_ITEM.search(text)
        if item:
            # The nearest line with content above the first list item is the list's key.
            above = [
                line
                for line in text[: item.start()].splitlines()
                if not _COMMENT_OR_BLANK.match(line)
            ]
            key = "".join(above[-1:])
            offset = max(len(item.group(1)) - (len(key) - len(key.lstrip(" "))), 0)
        self.indent(mapping=mapping, sequence=offset + 2, offset=offset)
        self.explicit_start = text.startswith("---")


def _refusal(detail: str) -> ConfigWriteError:
    return ConfigWriteError(f"Settings cannot be saved: {detail}")


def _held(section: Mapping[str, Any], key: str) -> Any:
    value = section.get(key)
    return None if isinstance(value, _Null) else value


def _same(held: Any, value: Any) -> bool:
    return bool(held == value) and isinstance(held, bool) == isinstance(value, bool)


def _commented(value: Any) -> Any:
    """Lists and maps as the parser's own kinds, which can hold the lines that follow them."""
    if isinstance(value, Mapping):
        return CommentedMap((key, _commented(item)) for key, item in value.items())
    if isinstance(value, list):
        return CommentedSeq(_commented(item) for item in value)
    return value


def _last_line(section: Any, key: Any) -> tuple[Any, Any, int]:
    """The holder, key and comment slot of the line a value ends on."""
    slot = _AFTER_VALUE
    value = section[key]
    # A list or map written on one line ends on the line of its key.
    while isinstance(value, CommentedSeq | CommentedMap) and value and not value.fa.flow_style():
        section = value
        if isinstance(value, CommentedSeq):
            key, slot = len(value) - 1, _AFTER_ITEM
        else:
            key, slot = next(reversed(value)), _AFTER_VALUE
        value = section[key]
    return section, key, slot


def _take_lines_after(section: Any, name: str) -> str:
    """Detach the comment and blank lines that follow a value in the file."""
    holder, key, slot = _last_line(section, name)
    comments = holder.ca.items.get(key)
    token: CommentToken | None = comments[slot] if comments else None
    if token is None:
        return ""
    end_of_line, _, after = token.value.partition("\n")
    # A comment on the value's own line stays on that line.
    if end_of_line:
        token.value = f"{end_of_line}\n"
    else:
        comments[slot] = None
    return after


def _put_lines_after(section: Any, name: str, lines: str) -> None:
    """Attach comment and blank lines after the value the key holds now."""
    holder, key, slot = _last_line(section, name)
    comments = holder.ca.items.setdefault(key, [None, None, None, None])
    if comments[slot] is None:
        comments[slot] = CommentToken(f"\n{lines}", CommentMark(0), None)
    else:
        comments[slot].value += lines


def _set(document: MutableMapping[str, Any], key: str, value: Any, named: str) -> bool:
    """Set one dotted key in the parsed file; False when the file already holds the value."""
    *sections, name = key.split(".")
    node = document
    for depth, section in enumerate(sections, start=1):
        if _held(node, section) is None:
            node[section] = CommentedMap()
        node = node[section]
        if not isinstance(node, MutableMapping):
            raise _refusal(f"{'.'.join(sections[:depth])} in {named} is not a section")
    present = name in node
    if present and _same(_held(node, name), value):
        return False
    after = _take_lines_after(node, name) if present else ""
    node[name] = _commented(value)
    if after:
        _put_lines_after(node, name, after)
    return True


def write_keys(path: Path, changes: Mapping[str, Any]) -> None:
    """Set dotted keys in the config file, keeping its comments and layout."""
    # Imported here: the services package imports modules that may import this one.
    from wavecore.api.services import settings_file

    named = f"the config file {path}"
    target = path.resolve()
    parser = _LayoutKeepingParser()
    with settings_file.locked(target):
        try:
            text, document = read_config_file(target, parser)
        except ConfigFileProblem as error:
            raise _refusal(f"{named} {error}") from error
        head = ""
        if document is None:
            # The parser drops the comments of a file without keys, so they are written back.
            head = "".join(
                f"{line}\n" for line in text.splitlines() if _COMMENT_OR_BLANK.match(line)
            )
            document = CommentedMap()
        changed = False
        for key, value in changes.items():
            # Every key is set, also after the first one that changed the file.
            changed = _set(document, key, value, named) or changed
        if not changed:
            return
        # An atomic replace ignores the file's own mode, so read-only is checked here.
        if not os.access(target, os.W_OK):
            raise _refusal(f"{named} is read-only")
        parser.follow(text)
        stream = io.StringIO()
        parser.dump(document, stream)
        content = head + stream.getvalue()
        try:
            mode = stat.S_IMODE(target.stat().st_mode)
            # The text was read with its line ends translated, so the bytes say which it uses.
            if b"\r\n" in target.read_bytes():
                content = content.replace("\n", "\r\n")
            settings_file.write_text_atomic(target, content, mode)
        except OSError as error:
            raise _refusal(f"{named} cannot be written: {error.strerror}") from error
