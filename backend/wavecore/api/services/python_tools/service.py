"""Completion, rename and syntax checking for a Python block script (PYRUN-19).

Every entry point reads the script; none of them ever runs it.
"""

import ast
import keyword
import os
import sys
import threading
from typing import Any

import jedi

from wavecore.api.exceptions import ValidationException

MAX_SCRIPT_BYTES = 200 * 1024

_KINDS = {
    "module": "module",
    "class": "class",
    "function": "function",
    "keyword": "keyword",
    "property": "member",
    "param": "variable",
    "instance": "variable",
    "statement": "variable",
    "path": "module",
}

# jedi talks to the introspected interpreter over one pipe per environment.
_LOCK = threading.RLock()
_ENVIRONMENTS: dict[str, Any] = {}


def resolve_environment(interpreter: str) -> Any:
    """The interpreter jedi introspects: the row when it names an executable, else WAVE's own."""
    path = interpreter.strip()
    if not (path and os.path.isfile(path) and os.access(path, os.X_OK)):
        path = sys.executable
    with _LOCK:
        environment = _ENVIRONMENTS.get(path)
        if environment is None:
            environment = jedi.create_environment(path, safe=False)
            _ENVIRONMENTS[path] = environment
    return environment


def complete(script: str, line: int, column: int, interpreter: str) -> list[dict[str, Any]]:
    """Completion items at the cursor; an introspection failure degrades to no items."""
    _check_size(script)
    _check_line(script, line)
    try:
        with _LOCK:
            environment = resolve_environment(interpreter)
            script_object = jedi.Script(code=script, environment=environment)
            return [_item(completion) for completion in script_object.complete(line, column)]
    except Exception:
        return []


def rename(
    script: str, line: int, column: int, new_name: str, interpreter: str
) -> list[dict[str, Any]]:
    """The edits that rename the symbol at the cursor everywhere in its scope."""
    _check_size(script)
    _check_line(script, line)
    if not new_name.isidentifier() or keyword.iskeyword(new_name):
        raise ValidationException(f"Invalid variable name: '{new_name}'")
    if new_name.startswith("__"):
        raise ValidationException(f"Variable names may not start with __: '{new_name}'")
    with _LOCK:
        environment = resolve_environment(interpreter)
        script_object = jedi.Script(code=script, environment=environment)
        references = script_object.get_references(
            line, column, include_builtins=False, scope="file"
        )
    if not references:
        raise ValidationException("Cannot rename: no symbol at the cursor")
    edits: list[dict[str, Any]] = [
        {
            "from_line": reference.line,
            "from_column": reference.column,
            "to_line": reference.line,
            "to_column": reference.column + len(reference.name),
            "text": new_name,
        }
        for reference in references
    ]
    edits.sort(key=lambda edit: (edit["from_line"], edit["from_column"]))
    return edits


def syntax_issues(script: str) -> list[dict[str, Any]]:
    """The syntax errors WAVE's own interpreter reports, one issue per error."""
    _check_size(script)
    try:
        ast.parse(script)
    except SyntaxError as error:
        return [
            {
                "line": error.lineno or 1,
                "column": max(0, (error.offset or 1) - 1),
                "message": error.msg,
            }
        ]
    return []


def _check_size(script: str) -> None:
    if len(script.encode("utf-8")) > MAX_SCRIPT_BYTES:
        raise ValidationException("Script exceeds 200 KB")


def _check_line(script: str, line: int) -> None:
    if line < 1 or line > len(script.split("\n")):
        raise ValidationException(f"Line {line} is outside the script")


def _item(completion: Any) -> dict[str, Any]:
    signatures = completion.get_signatures()
    documentation = completion.docstring()
    return {
        "label": completion.name,
        "kind": _KINDS.get(completion.type, "variable"),
        "signature": signatures[0].to_string() if signatures else None,
        "doc": documentation or None,
    }
