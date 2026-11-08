"""The output half of the K8s verbs (REQ-5.1.1, REQ-3.4.1.5).

The wire mode each output format asks the cluster for, and the JSON-safe values a
read hands back: plain data, JSON text, a yaml envelope or a table envelope. The
verbs request JSON in every mode and leave text rendering to the caller. kubectl's
type/name form and the empty streams a recorded exec failure leaves behind live
here too.
"""

import json
from contextlib import suppress
from typing import Any

from ..rest import UNREADABLE_BODY_MESSAGE, K8sApiError, K8sClient, K8sResource

TABLE_ACCEPT = "application/json;as=Table;g=meta.k8s.io;v=v1,application/json"
# Kubernetes Table column types that carry over; every other type prints as a string.
_COLUMN_TYPES = {"integer": "integer", "number": "float", "boolean": "boolean"}
_CELL_TYPES: dict[str, type | tuple[type, ...]] = {
    "integer": int,
    "float": (int, float),
    "boolean": bool,
    "string": str,
}


def table_unsupported_message(kind: str) -> str:
    """The message for a cluster that will not print a Table for the resolved kind."""
    return (
        f"This cluster will not print a table for kind '{kind}' "
        "- choose Map, JSON or YAML for this kind"
    )


def read_formatted(client: K8sClient, path: str, output_format: str) -> tuple[int, dict[str, Any]]:
    """GET a path in one output format's wire mode: (status, parsed object)."""
    accept, raw = _read_request_options(output_format)
    status, body = client.request("GET", path, None, accept=accept, raw=raw)
    return status, _decode_read_body(output_format, status, body)


def _read_request_options(output_format: str) -> tuple[str | None, bool]:
    if output_format == "table":
        return TABLE_ACCEPT, False
    if output_format in ("json", "yaml"):
        return None, True
    return None, False


def _decode_read_body(output_format: str, status: int, body: Any) -> dict[str, Any]:
    if output_format in ("json", "yaml"):
        return _decode_text_body(status, body)
    return dict(body)


def _decode_text_body(status: int, payload: Any) -> dict[str, Any]:
    """Raw text holds the parsed formats' contract: an unreadable 2xx body is an error."""
    if not payload:
        return {}
    decoded: Any = None
    with suppress(ValueError):
        decoded = json.loads(payload)
    if isinstance(decoded, dict):
        return decoded
    if status >= 400:
        return {}
    raise K8sApiError(UNREADABLE_BODY_MESSAGE)


def table_unsupported(status: int, body: dict[str, Any]) -> bool:
    """True when the cluster declined to print a Table: a 406, or a plain object at 200."""
    return status == 406 or (status < 400 and body.get("kind") != "Table")


def read_objects(parsed: dict[str, Any]) -> list[dict[str, Any]]:
    """The objects a read returned: Table embedded objects, a list's items, or the one object."""
    if parsed.get("kind") == "Table":
        return [row.get("object", {}) for row in parsed.get("rows", [])]
    if "items" in parsed:
        return list(parsed["items"])
    return [parsed] if parsed else []


def object_names(objects: list[dict[str, Any]]) -> list[str]:
    """Each object's metadata.name, in order."""
    return [str(obj.get("metadata", {}).get("name", "")) for obj in objects]


def strip_managed_fields(parsed: dict[str, Any]) -> dict[str, Any]:
    """Drop metadata.managedFields from every object a read answer carries, as kubectl does."""
    for obj in read_objects(parsed):
        obj.get("metadata", {}).pop("managedFields", None)
    parsed.get("metadata", {}).pop("managedFields", None)
    return parsed


def render_read_result(output_format: str, parsed: dict[str, Any]) -> Any:
    """The 'result' value: parsed object or items, a table envelope, JSON text or yaml envelope."""
    if output_format == "table":
        return table_from_k8s(parsed)
    if output_format == "json":
        return _serialized(parsed)
    if output_format == "yaml":
        return {"__wave_type": "yaml", "value": parsed}
    return parsed["items"] if "items" in parsed else parsed


def _serialized(parsed: dict[str, Any]) -> str:
    """The JSON text of the document; an empty document renders as empty text."""
    if not parsed:
        return ""
    return json.dumps(parsed)


def empty_read_result(output_format: str, *, listed: bool) -> Any:
    """The 'result' value for a recorded failure, in the type the format declares."""
    if output_format == "table":
        return table_from_k8s({})
    if output_format in ("json", "yaml"):
        return ""
    return [] if listed else {}


def table_from_k8s(parsed: dict[str, Any]) -> dict[str, Any]:
    """A table envelope from a Kubernetes Table: columns verbatim, types downgraded on conflict."""
    columns = parsed.get("columnDefinitions", [])
    rows = [list(row.get("cells", [])) for row in parsed.get("rows", [])]
    names = [str(column.get("name", "")) for column in columns]
    types = [
        _column_type(column, _column_cells(rows, index)) for index, column in enumerate(columns)
    ]
    return {
        "__wave_type": "table",
        "columns": [
            {"name": name, "type": col_type} for name, col_type in zip(names, types, strict=True)
        ],
        "rows": [
            [_cell(cell, col_type) for cell, col_type in zip(cells, types, strict=False)]
            for cells in rows
        ],
    }


def _column_cells(rows: list[list[Any]], index: int) -> list[Any]:
    return [cells[index] for cells in rows if index < len(cells)]


def _column_type(column: dict[str, Any], cells: list[Any]) -> str:
    col_type = _COLUMN_TYPES.get(str(column.get("type", "")), "string")
    if all(_conforms(cell, col_type) for cell in cells):
        return col_type
    return "string"


def _conforms(cell: Any, col_type: str) -> bool:
    # bool is an int subclass, so it only ever conforms to a boolean column.
    if isinstance(cell, bool):
        return col_type == "boolean"
    return cell is None or isinstance(cell, _CELL_TYPES[col_type])


def _cell(cell: Any, col_type: str) -> Any:
    if col_type == "string" and cell is not None and not isinstance(cell, str):
        return str(cell)
    return cell


def type_name(resource: K8sResource, name: str) -> str:
    """kubectl's type/name form: the singular kind, its API group when it has one, the object."""
    group, _, _version = resource.group_version.rpartition("/")
    suffix = f".{group}" if group else ""
    return f"{resource.kind.lower()}{suffix}/{name}"


def empty_streams() -> dict[str, Any]:
    """The stream outputs a recorded exec failure leaves behind."""
    return {"stdout": "", "stderr": "", "exit_code": 0}
