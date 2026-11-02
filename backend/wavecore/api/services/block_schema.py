"""One schema lookup for every Block: plugin, control and Function Block (REQ-3.1.1.5).

A Function Block's fields come from the definition it runs: the Local definition, the
edit-mode draft, or the pinned library version, never the latest one (REQ-3.1.2.1).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from wavecore.core.functions.block_fields import function_block_fields, function_block_outputs

BlockKind = Literal["plugin", "control", "function"]
FunctionRegistry = Mapping[str, Mapping[str, Any]]

_DEFAULT_VERSION = "1.0.0"


@dataclass(frozen=True)
class BlockSchema:
    """A Block's declared fields, its outputs and the tier it belongs to."""

    kind: BlockKind
    fields: Sequence[Any] = field(default_factory=list)
    outputs: Sequence[Any] = field(default_factory=list)


def block_schema(
    data: Mapping[str, Any], *, registry: FunctionRegistry | None = None
) -> BlockSchema:
    """The fields and outputs of the Block whose node data is ``data``."""
    element_type = str(data.get("elementType") or "")
    node_type = data.get("nodeType")
    version = str(data.get("version") or _DEFAULT_VERSION)
    if node_type == "function" or element_type == "function":
        return _function_schema(data, registry)
    if node_type == "control" or _is_control_id(element_type):
        return _control_schema(element_type, version)
    return _plugin_schema(element_type, version)


def _is_control_id(element_type: str) -> bool:
    from wavecore.models.enums import ControlId

    return element_type in {control_id.value for control_id in ControlId}


def _plugin_schema(element_type: str, version: str) -> BlockSchema:
    from wavecore.core.plugin_registry import get_plugin

    plugin = get_plugin(element_type, version)
    if plugin is None:
        return BlockSchema(kind="plugin")
    metadata = plugin.metadata
    return BlockSchema(
        kind="plugin",
        fields=list(metadata.get("parameters") or []),
        outputs=list(metadata.get("output_schema") or []),
    )


def _control_metadata(element_type: str, version: str) -> Mapping[str, Any] | None:
    from wavecore.controls.registry import get_control_implementation
    from wavecore.models.enums import ControlId

    try:
        control_id = ControlId(element_type)
    except ValueError:
        return None
    implementation = get_control_implementation(control_id, version)
    return implementation().metadata if implementation is not None else None


def _control_schema(element_type: str, version: str) -> BlockSchema:
    metadata = _control_metadata(element_type, version)
    if metadata is None:
        return BlockSchema(kind="control")
    return BlockSchema(
        kind="control",
        fields=list(metadata.get("parameter_schema") or []),
        outputs=list(metadata.get("output_schema") or []),
    )


def _function_schema(data: Mapping[str, Any], registry: FunctionRegistry | None) -> BlockSchema:
    definition = _function_definition(data, registry)
    if definition is None:
        return BlockSchema(kind="function")
    return BlockSchema(
        kind="function",
        fields=function_block_fields(definition),
        outputs=function_block_outputs(definition),
    )


def _function_definition(
    data: Mapping[str, Any], registry: FunctionRegistry | None
) -> Mapping[str, Any] | None:
    """The Function definition a Function Block runs, or None when none can be read."""
    if data.get("functionLifecycle", "local") == "local":
        local = data.get("localDefinition")
        return local if isinstance(local, Mapping) else None
    draft = data.get("draft")
    if data.get("editMode") and isinstance(draft, Mapping):
        return draft
    return _pinned_version(data, registry)


def _pinned_version(
    data: Mapping[str, Any], registry: FunctionRegistry | None
) -> Mapping[str, Any] | None:
    from wavecore.api.services.functions import _storage

    function_id = str(data.get("functionId") or "")
    version = str(data.get("functionVersion") or "")
    if not function_id or not version:
        return None
    entry = (registry or {}).get(function_id)
    if entry is not None and entry.get("version") == version:
        return entry
    try:
        return _storage.load_version(function_id, version)
    except LookupError:
        return None
