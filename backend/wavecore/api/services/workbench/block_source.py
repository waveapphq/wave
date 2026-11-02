"""What a block's type is called, and the Source its console lines carry (EXEC-25)."""

from collections.abc import Mapping
from typing import Any

from wavecore.models.enums import ControlId

# Palette names the catalog does not give: nine differ from it, the container has no entry.
_PALETTE_NAMES: dict[str, str] = {
    "http-client": "HTTP",
    "csv-parser": "CSV",
    "excel-parser": "Excel",
    "json-parser": "JSON",
    "xml-parser": "XML",
    "if-else": "If / Else",
    "switch-case": "Switch",
    "try-catch-finally": "Try / Catch",
    "variable-setter": "Var Setter",
    "remote-execution": "Remote Execution",
}

_FUNCTION_TYPE = "Function"
_FIRST_VERSION = "1.0.0"


def _catalog_name(metadata: Mapping[str, Any] | None) -> str:
    return str((metadata or {}).get("name") or "")


def type_name(type_id: str, metadata: Mapping[str, Any] | None) -> str:
    """A type's name as the palette shows it: its palette name, else the catalog's, else its id."""
    return _PALETTE_NAMES.get(type_id) or _catalog_name(metadata) or type_id


def block_source(type_id: str, metadata: Mapping[str, Any] | None, label: str | None) -> str:
    """A block's Source from its type id, its type's catalog metadata and its Name."""
    shown = type_name(type_id, metadata)
    typed = str(label or "").strip()
    if typed in ("", shown, _catalog_name(metadata)):
        return shown
    return f"{shown} : {typed}" if shown else typed


def _node_type(node: Mapping[str, Any]) -> tuple[str, Mapping[str, Any] | None]:
    """A canvas node's type id and its type's catalog metadata, read from the node alone."""
    data = node.get("data") or {}
    if data.get("nodeType") == "function":
        return _FUNCTION_TYPE, None
    type_id = str(data.get("elementType") or "")
    version = str(data.get("version") or _FIRST_VERSION)
    return type_id, _catalog_metadata(type_id, version)


def node_type_name(node: Mapping[str, Any]) -> str:
    """What a canvas node's type is called: the default Name of a block of that type."""
    return type_name(*_node_type(node))


def node_source(node: Mapping[str, Any]) -> str:
    """A canvas node's Source, read from the node alone."""
    return block_source(*_node_type(node), (node.get("data") or {}).get("label"))


def _catalog_metadata(type_id: str, version: str) -> Mapping[str, Any] | None:
    """The metadata of the plugin or control registered under a type id and version."""
    from wavecore.controls.registry import get_control_implementation
    from wavecore.core.plugin_registry import get_plugin

    plugin = get_plugin(type_id, version)
    if plugin is not None:
        return plugin.metadata
    try:
        control_class = get_control_implementation(ControlId(type_id), version)
    except ValueError:
        return None
    return control_class().metadata if control_class is not None else None
