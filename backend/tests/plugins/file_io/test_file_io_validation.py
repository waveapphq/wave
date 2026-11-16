"""File I/O parameter validation (REQ-3.4.1.10).

Every rejection carries the exact message of the File I/O validation table, per operation.
Validation refuses no path: a `..` segment and a relative path are accepted, and there is no
system-directory blocklist, since the block runs with the server's own permissions on WAVE
and with the SSH user's on the remote host.
"""

import inspect
import re
from typing import Any

import pytest

from wavecore.plugins import file_io
from wavecore.plugins.file_io import FileIOPlugin

SUPPORTED = "read, write, copy, move, delete, stats, list, create_folder"

VALID_PARAMS: dict[str, dict[str, Any]] = {
    "read": {"operation": "read", "path": "/data/in.txt"},
    "write": {"operation": "write", "path": "/data/out.txt", "content": "text"},
    "copy": {"operation": "copy", "source": "/data/a.txt", "destination": "/data/b.txt"},
    "move": {"operation": "move", "source": "/data/a.txt", "destination": "/data/b.txt"},
    "delete": {"operation": "delete", "path": "/data/gone.txt"},
    "stats": {"operation": "stats", "path": "/data/thing"},
    "list": {"operation": "list", "path": "/data/folder"},
    "create_folder": {"operation": "create_folder", "path": "/data/new"},
}


def exact(message: str) -> str:
    """Anchor an exact message for pytest.raises(match=...)."""
    return f"^{re.escape(message)}$"


def params_for(operation: str, **overrides: Any) -> dict[str, Any]:
    """A valid parameter set for one operation with the overrides applied."""
    merged = dict(VALID_PARAMS[operation])
    merged.update(overrides)
    return merged


def compile_reason(pattern: str) -> str:
    """The regular-expression compiler's own message for a pattern that does not compile."""
    try:
        re.compile(pattern)
    except re.error as exc:
        return str(exc)
    raise AssertionError(f"{pattern!r} compiles")


class TestOperationParameter:
    """The operation is required, is a string, and is one of the eight."""

    async def test_missing_operation(self) -> None:
        with pytest.raises(ValueError, match=exact("Missing required parameter: operation")):
            await FileIOPlugin().validate({})

    @pytest.mark.parametrize(
        ("value", "type_name"),
        [(123, "int"), (None, "NoneType"), (["read"], "list"), (True, "bool")],
    )
    async def test_operation_must_be_a_string(self, value: Any, type_name: str) -> None:
        message = f"Parameter 'operation' must be a string, got {type_name}"

        with pytest.raises(TypeError, match=exact(message)):
            await FileIOPlugin().validate({"operation": value, "path": "/data/in.txt"})

    @pytest.mark.parametrize("value", ["rename", "READ", "", "list_entries"])
    async def test_unknown_operation(self, value: str) -> None:
        message = f"Invalid operation: {value!r}. Supported operations: {SUPPORTED}"

        with pytest.raises(ValueError, match=exact(message)):
            await FileIOPlugin().validate({"operation": value, "path": "/data/in.txt"})

    @pytest.mark.parametrize("operation", list(VALID_PARAMS))
    async def test_every_operation_accepts_its_own_parameters(self, operation: str) -> None:
        await FileIOPlugin().validate(params_for(operation))


class TestRequiredParametersPerOperation:
    """Each operation names the parameter it is missing with its own label."""

    @pytest.mark.parametrize(
        ("operation", "missing", "label"),
        [
            ("read", "path", "Read"),
            ("write", "path", "Write"),
            ("write", "content", "Write"),
            ("copy", "source", "Copy"),
            ("copy", "destination", "Copy"),
            ("move", "source", "Move"),
            ("move", "destination", "Move"),
            ("delete", "path", "Delete"),
            ("stats", "path", "Stats"),
            ("list", "path", "List"),
            ("create_folder", "path", "Create folder"),
        ],
    )
    async def test_missing_parameter(self, operation: str, missing: str, label: str) -> None:
        params = params_for(operation)
        del params[missing]
        message = f"{label} operation requires '{missing}' parameter"

        with pytest.raises(ValueError, match=exact(message)):
            await FileIOPlugin().validate(params)


class TestStringParameterTypes:
    """path, source, destination, content and pattern are strings."""

    @pytest.mark.parametrize(
        ("operation", "name"),
        [
            ("read", "path"),
            ("write", "path"),
            ("write", "content"),
            ("delete", "path"),
            ("stats", "path"),
            ("list", "path"),
            ("create_folder", "path"),
            ("copy", "source"),
            ("copy", "destination"),
            ("move", "source"),
            ("move", "destination"),
            ("list", "pattern"),
        ],
    )
    async def test_non_string_is_refused(self, operation: str, name: str) -> None:
        message = f"Parameter '{name}' must be a string, got int"

        with pytest.raises(TypeError, match=exact(message)):
            await FileIOPlugin().validate(params_for(operation, **{name: 123}))

    @pytest.mark.parametrize(
        ("value", "type_name"), [(None, "NoneType"), ([], "list"), ({}, "dict"), (1.5, "float")]
    )
    async def test_type_name_comes_from_the_value(self, value: Any, type_name: str) -> None:
        message = f"Parameter 'path' must be a string, got {type_name}"

        with pytest.raises(TypeError, match=exact(message)):
            await FileIOPlugin().validate(params_for("read", path=value))


class TestBooleanParameterTypes:
    """missing_ok, size and recursive are booleans."""

    @pytest.mark.parametrize(
        ("operation", "name"),
        [
            ("delete", "missing_ok"),
            ("stats", "size"),
            ("list", "size"),
            ("list", "recursive"),
        ],
    )
    async def test_non_boolean_is_refused(self, operation: str, name: str) -> None:
        message = f"Parameter '{name}' must be a boolean, got str"

        with pytest.raises(TypeError, match=exact(message)):
            await FileIOPlugin().validate(params_for(operation, **{name: "true"}))

    @pytest.mark.parametrize(("value", "type_name"), [(1, "int"), (None, "NoneType"), ("", "str")])
    async def test_type_name_comes_from_the_value(self, value: Any, type_name: str) -> None:
        message = f"Parameter 'missing_ok' must be a boolean, got {type_name}"

        with pytest.raises(TypeError, match=exact(message)):
            await FileIOPlugin().validate(params_for("delete", missing_ok=value))

    @pytest.mark.parametrize(
        ("operation", "name"),
        [
            ("delete", "missing_ok"),
            ("stats", "size"),
            ("list", "size"),
            ("list", "recursive"),
        ],
    )
    @pytest.mark.parametrize("value", [True, False])
    async def test_booleans_are_accepted(self, operation: str, name: str, value: bool) -> None:
        await FileIOPlugin().validate(params_for(operation, **{name: value}))


class TestIfExistsWrite:
    """Write offers Replace it, Append to it and Fail the block."""

    @pytest.mark.parametrize("value", ["overwrite", "append", "fail"])
    async def test_accepted_values(self, value: str) -> None:
        await FileIOPlugin().validate(params_for("write", if_exists=value))

    @pytest.mark.parametrize("value", ["replace", "OVERWRITE", "", 5])
    async def test_refused_values(self, value: Any) -> None:
        message = f"Invalid if_exists: {value!r}. Must be 'overwrite', 'append' or 'fail'."

        with pytest.raises(ValueError, match=exact(message)):
            await FileIOPlugin().validate(params_for("write", if_exists=value))


class TestIfExistsCopyAndMove:
    """Copy and Move offer Replace it and Fail the block only."""

    @pytest.mark.parametrize("operation", ["copy", "move"])
    @pytest.mark.parametrize("value", ["overwrite", "fail"])
    async def test_accepted_values(self, operation: str, value: str) -> None:
        await FileIOPlugin().validate(params_for(operation, if_exists=value))

    @pytest.mark.parametrize("operation", ["copy", "move"])
    @pytest.mark.parametrize("value", ["append", "replace", "", 5])
    async def test_refused_values(self, operation: str, value: Any) -> None:
        message = f"Invalid if_exists: {value!r}. Must be 'overwrite' or 'fail'."

        with pytest.raises(ValueError, match=exact(message)):
            await FileIOPlugin().validate(params_for(operation, if_exists=value))


class TestChecksumParameter:
    """Stats takes one of the five digests."""

    @pytest.mark.parametrize("value", ["none", "md5", "sha1", "sha256", "sha512"])
    async def test_accepted_values(self, value: str) -> None:
        await FileIOPlugin().validate(params_for("stats", checksum=value))

    @pytest.mark.parametrize("value", ["crc32", "SHA256", "", 1])
    async def test_refused_values(self, value: Any) -> None:
        message = (
            f"Invalid checksum: {value!r}. Must be 'none', 'md5', 'sha1', 'sha256' or 'sha512'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await FileIOPlugin().validate(params_for("stats", checksum=value))


class TestOutputFormatParameter:
    """Stats presents its answer as individual outputs, one map, or a one-row table."""

    @pytest.mark.parametrize("value", ["individual", "map", "table"])
    async def test_accepted_values(self, value: str) -> None:
        await FileIOPlugin().validate(params_for("stats", output_format=value))

    @pytest.mark.parametrize("value", ["rows", "Individual", "", 0])
    async def test_refused_values(self, value: Any) -> None:
        message = f"Invalid output_format: {value!r}. Must be 'individual', 'map' or 'table'."

        with pytest.raises(ValueError, match=exact(message)):
            await FileIOPlugin().validate(params_for("stats", output_format=value))


class TestPatternParameter:
    """List filters on a Python regular expression matched against each entry name."""

    @pytest.mark.parametrize("value", ["", r"^report-.*\.json$", "log", "(a|b)+"])
    async def test_compiling_patterns_are_accepted(self, value: str) -> None:
        await FileIOPlugin().validate(params_for("list", pattern=value))

    @pytest.mark.parametrize("value", ["[", "(", "*", "a{2,1}"])
    async def test_pattern_that_does_not_compile(self, value: str) -> None:
        message = f"Invalid pattern: {compile_reason(value)}"

        with pytest.raises(ValueError, match=exact(message)):
            await FileIOPlugin().validate(params_for("list", pattern=value))


class TestParentAndRelativePaths:
    """A `..` segment and a relative path are accepted in every path-like parameter."""

    @pytest.mark.parametrize(
        ("operation", "name"),
        [
            ("read", "path"),
            ("write", "path"),
            ("delete", "path"),
            ("stats", "path"),
            ("list", "path"),
            ("create_folder", "path"),
            ("copy", "source"),
            ("copy", "destination"),
            ("move", "source"),
            ("move", "destination"),
        ],
    )
    @pytest.mark.parametrize(
        "value",
        [
            "../secrets.txt",
            "/data/../etc/passwd",
            "..",
            "reports/out.txt",
            "artifact://../outside.txt",
            "testdata://../other-test/input.csv",
        ],
    )
    async def test_the_path_is_accepted(self, operation: str, name: str, value: str) -> None:
        await FileIOPlugin().validate(params_for(operation, **{name: value}))

    def test_the_source_has_no_traversal_message(self) -> None:
        assert "Path traversal not allowed" not in inspect.getsource(file_io)


class TestNoSystemDirectoryBlocklist:
    """There is no blocklist and no blocklist message."""

    def test_there_is_no_system_dirs_constant(self) -> None:
        assert not hasattr(file_io, "_SYSTEM_DIRS")

    def test_the_source_has_no_blocklist_message(self) -> None:
        source = inspect.getsource(file_io)

        assert "Access to system directory not allowed" not in source
        assert "_SYSTEM_DIRS" not in source

    @pytest.mark.parametrize(
        "path", ["/etc/hosts", "/usr/bin/tool", "/boot/config", "/root/notes.txt", "/sys/uptime"]
    )
    async def test_absolute_paths_are_not_blocklisted(self, path: str) -> None:
        await FileIOPlugin().validate(params_for("read", path=path))
