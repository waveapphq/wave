"""File I/O Plugin (REQ-3.4.1.10, REQ-3.4.3.1, REQ-3.4.3.2).

Eight operations on files and folders - read, write, copy, move, delete,
stats, list and create folder - addressed as artifact://, testdata:// or a
plain path. On WAVE every reference goes through the shared plugin path
resolver: the read flavor for what the block only reads, the write flavor for
every target, which keeps the Test Data area read-only. The standard-library
core then runs off the loop through the verb bridge; inside a Remote Execution
body the same core runs on the remote host against its own paths.
"""

import os
from collections.abc import Callable
from typing import Any

from wavecore.plugins import _file_ops
from wavecore.plugins._file_paths import resolve_plugin_path, scheme_relative_path
from wavecore.plugins._user_patterns import compile_user_pattern
from wavecore.plugins._verb_bridge import run_verb
from wavecore.plugins.base import PluginBase

OPERATIONS = ["read", "write", "copy", "move", "delete", "stats", "list", "create_folder"]

_LABELS = {
    "read": "Read",
    "write": "Write",
    "copy": "Copy",
    "move": "Move",
    "delete": "Delete",
    "stats": "Stats",
    "list": "List",
    "create_folder": "Create folder",
}
_PATH_OPERATIONS = ["read", "write", "delete", "stats", "list", "create_folder"]
_TRANSFER_OPERATIONS = ["copy", "move"]
_IF_EXISTS_WRITE = ["overwrite", "append", "fail"]
_IF_EXISTS_TRANSFER = ["overwrite", "fail"]
_CHECKSUMS = ["none", "md5", "sha1", "sha256", "sha512"]
_OUTPUT_FORMATS = ["individual", "map", "table"]

_PATH_DESCRIPTION = (
    "The file or folder the operation works on. Read takes a file; Write and Create folder "
    "take the full target path and create missing parents; Delete removes a file or a whole "
    "folder; Stats reports on a file or folder and a missing path is not an error; List "
    "takes a folder. artifact://, testdata:// (read-only) or an absolute or relative path "
    "where the block runs."
)
_SOURCE_DESCRIPTION = (
    "The file or folder to copy or move: artifact://, testdata:// (Copy only, read-only) or "
    "an absolute or relative path where the block runs."
)
_DESTINATION_DESCRIPTION = (
    "The full target path, including the new name; missing folders are created. "
    "artifact:// or an absolute or relative path where the block runs; testdata:// is "
    "read-only."
)
_IF_EXISTS_DESCRIPTION = (
    "What happens when the target is already there: replace it, append to it (Write only) "
    "or fail the block. Replacing a folder merges: files inside are replaced, others are kept."
)


class FileIOPlugin(PluginBase):
    """Reads, writes, copies, moves, deletes, inspects and lists files and folders."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "file-io",
            "name": "File I/O",
            "version": "1.0.0",
            "category": "system",
            "remotable": True,
            "description": (
                "Reads and writes UTF-8 text files, copies, moves and deletes files and "
                "folders, reports on a path and lists a folder, over artifact://, "
                "testdata:// and absolute or relative paths."
            ),
            "parameters": [
                {
                    "name": "operation",
                    "type": "string",
                    "trim": True,
                    "required": True,
                    "default": "read",
                    "enum_values": list(OPERATIONS),
                    "description": (
                        "What to do. Read returns a file's text. Write creates or changes a "
                        "file. Copy and Move take a source and a destination. Delete removes "
                        "a file or folder. Stats reports whether a path is there and what it "
                        "is. List returns a folder's entries as a table. Create folder makes "
                        "a folder and its missing parents."
                    ),
                },
                _path_parameter("path", _PATH_OPERATIONS, _PATH_DESCRIPTION),
                {
                    "name": "content",
                    "type": "string",
                    "required": False,
                    "required_when": {"field": "operation", "values": ["write"]},
                    "description": "Text to write, UTF-8.",
                },
                _choice("if_exists", _IF_EXISTS_WRITE, "overwrite", _IF_EXISTS_DESCRIPTION),
                _path_parameter("source", _TRANSFER_OPERATIONS, _SOURCE_DESCRIPTION),
                _path_parameter("destination", _TRANSFER_OPERATIONS, _DESTINATION_DESCRIPTION),
                _toggle("missing_ok", "Succeed when there is nothing to delete."),
                _toggle(
                    "size",
                    "Include the size in bytes (Stats and List). A folder's size is "
                    "everything inside it, at every depth.",
                ),
                _choice(
                    "checksum",
                    _CHECKSUMS,
                    "none",
                    "Digest of the file's bytes (Stats). Empty for a folder.",
                ),
                _choice(
                    "output_format",
                    _OUTPUT_FORMATS,
                    "individual",
                    "How Stats answers: individual outputs, one map, or a one-row table.",
                ),
                {
                    "name": "pattern",
                    "type": "string",
                    "required": False,
                    "default": "",
                    "description": (
                        "Python regular expression matched against each entry name (List). "
                        "Empty lists everything."
                    ),
                },
                _toggle("recursive", "List entries at every depth below the folder."),
            ],
            "return_type": "map",
            "output_schema": [
                {"name": "content", "type": "string", "description": "The file's text (Read)."},
                {
                    "name": "exists",
                    "type": "boolean",
                    "description": "True when the path is there (Stats).",
                },
                {
                    "name": "type",
                    "type": "string",
                    "description": "file, folder, or empty when the path is missing (Stats).",
                },
                {
                    "name": "modified",
                    "type": "string",
                    "description": (
                        "Last modified, ISO-8601 UTC; empty when the path is missing (Stats)."
                    ),
                },
                {
                    "name": "size",
                    "type": "integer",
                    "description": "Size in bytes (Stats with Size ticked).",
                },
                {
                    "name": "checksum",
                    "type": "string",
                    "description": (
                        "Hex digest; empty for a folder or a missing path (Stats with a "
                        "checksum chosen)."
                    ),
                },
                {
                    "name": "stats",
                    "type": "map",
                    "description": (
                        "exists, type, modified, and size or checksum when chosen, as one "
                        "map or a one-row table (Stats with Output format Map or Table)."
                    ),
                    "type_when": [
                        {"when": [{"field": "output_format", "values": ["table"]}], "type": "table"}
                    ],
                },
                {
                    "name": "entries",
                    "type": "table",
                    "description": (
                        "One row per entry: name, path, type, modified, and size when "
                        "ticked (List)."
                    ),
                },
                {"name": "count", "type": "integer", "description": "Number of entries (List)."},
            ],
            "author": "WAVE Framework",
            "tags": ["file", "io", "system", "storage"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate the operation, then the rows that operation reads."""
        _VALIDATORS[_validate_operation(params)](params)

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Resolve the operation's paths on WAVE, then run the core off the loop."""
        return await run_verb(_file_ops.run, context["parameters"], context, prepare=prepare)


def _path_parameter(name: str, operations: list[str], description: str) -> dict[str, Any]:
    return {
        "name": name,
        "type": "string",
        "trim": True,
        "required": False,
        "required_when": {"field": "operation", "values": list(operations)},
        "description": description,
    }


def _toggle(name: str, description: str) -> dict[str, Any]:
    return {
        "name": name,
        "type": "boolean",
        "required": False,
        "default": False,
        "description": description,
    }


def _choice(name: str, values: list[str], default: str, description: str) -> dict[str, Any]:
    return {
        "name": name,
        "type": "string",
        "required": False,
        "default": default,
        "enum_values": list(values),
        "description": description,
    }


def _validate_operation(params: dict[str, Any]) -> str:
    if "operation" not in params:
        raise ValueError("Missing required parameter: operation")
    operation = params["operation"]
    if not isinstance(operation, str):
        raise TypeError(f"Parameter 'operation' must be a string, got {type(operation).__name__}")
    if operation not in OPERATIONS:
        raise ValueError(
            f"Invalid operation: {operation!r}. Supported operations: {', '.join(OPERATIONS)}"
        )
    return operation


def _check_string(params: dict[str, Any], name: str) -> None:
    value = params[name]
    if not isinstance(value, str):
        raise TypeError(f"Parameter '{name}' must be a string, got {type(value).__name__}")


def _require_string(params: dict[str, Any], name: str, operation: str) -> None:
    if name not in params:
        raise ValueError(f"{_LABELS[operation]} operation requires '{name}' parameter")
    _check_string(params, name)


def _check_boolean(params: dict[str, Any], name: str) -> None:
    if name in params and not isinstance(params[name], bool):
        raise TypeError(f"Parameter '{name}' must be a boolean, got {type(params[name]).__name__}")


def _check_choice(params: dict[str, Any], name: str, values: list[str]) -> None:
    if name in params and params[name] not in values:
        listing = ", ".join(repr(value) for value in values[:-1]) + f" or {values[-1]!r}"
        raise ValueError(f"Invalid {name}: {params[name]!r}. Must be {listing}.")


def _check_pattern(params: dict[str, Any]) -> None:
    if "pattern" not in params:
        return
    _check_string(params, "pattern")
    try:
        compile_user_pattern(params["pattern"])
    except ValueError as error:
        raise ValueError(f"Invalid pattern: {error}") from error


def _validate_read(params: dict[str, Any]) -> None:
    _require_string(params, "path", "read")


def _validate_write(params: dict[str, Any]) -> None:
    _require_string(params, "path", "write")
    _require_string(params, "content", "write")
    _check_choice(params, "if_exists", _IF_EXISTS_WRITE)


def _validate_copy(params: dict[str, Any]) -> None:
    _validate_transfer(params, "copy")


def _validate_move(params: dict[str, Any]) -> None:
    _validate_transfer(params, "move")


def _validate_transfer(params: dict[str, Any], operation: str) -> None:
    _require_string(params, "source", operation)
    _require_string(params, "destination", operation)
    _check_choice(params, "if_exists", _IF_EXISTS_TRANSFER)


def _validate_delete(params: dict[str, Any]) -> None:
    _require_string(params, "path", "delete")
    _check_boolean(params, "missing_ok")


def _validate_stats(params: dict[str, Any]) -> None:
    _require_string(params, "path", "stats")
    _check_boolean(params, "size")
    _check_choice(params, "checksum", _CHECKSUMS)
    _check_choice(params, "output_format", _OUTPUT_FORMATS)


def _validate_list(params: dict[str, Any]) -> None:
    _require_string(params, "path", "list")
    _check_pattern(params)
    _check_boolean(params, "recursive")
    _check_boolean(params, "size")


def _validate_create_folder(params: dict[str, Any]) -> None:
    _require_string(params, "path", "create_folder")


_VALIDATORS: dict[str, Callable[[dict[str, Any]], None]] = {
    "read": _validate_read,
    "write": _validate_write,
    "copy": _validate_copy,
    "move": _validate_move,
    "delete": _validate_delete,
    "stats": _validate_stats,
    "list": _validate_list,
    "create_folder": _validate_create_folder,
}


def _resolve(
    path: str, context: dict[str, Any], *, read_only_ok: bool, removes: bool = False
) -> str:
    return str(
        resolve_plugin_path(
            path,
            context.get("artifacts_dir"),
            context.get("testdata_dirs"),
            read_only_ok=read_only_ok,
            removes=removes,
        )
    )


def _write_target(path: str, context: dict[str, Any]) -> str:
    return _resolve(path, context, read_only_ok=False)


def _removed_target(path: str, context: dict[str, Any]) -> str:
    return _resolve(path, context, read_only_ok=False, removes=True)


def _read_source(path: str, context: dict[str, Any]) -> str:
    """What the block reads, copies or lists; a bare scheme root names its folder."""
    return _resolve(path, context, read_only_ok=True)


def _stats_target(path: str, context: dict[str, Any]) -> str:
    """Stats never fails on a missing path: it reports on the place the file would be."""
    try:
        return _read_source(path, context)
    except FileNotFoundError:
        roots = context.get("testdata_dirs") or []
        return os.path.join(os.path.abspath(roots[0]), scheme_relative_path(path))


_TARGETS: dict[str, list[tuple[str, Callable[[str, dict[str, Any]], str]]]] = {
    "read": [("path", _read_source)],
    "write": [("path", _write_target)],
    "copy": [("source", _read_source), ("destination", _write_target)],
    "move": [("source", _removed_target), ("destination", _write_target)],
    "delete": [("path", _removed_target)],
    "stats": [("path", _stats_target)],
    "list": [("path", _read_source)],
    "create_folder": [("path", _write_target)],
}


def prepare(params: dict[str, Any], context: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Resolve the operation's paths on WAVE; File I/O has no values to mask."""
    resolved = dict(params)
    for name, resolve in _TARGETS[params["operation"]]:
        resolved[name] = resolve(params[name], context)
    return resolved, []
