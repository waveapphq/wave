"""The read-only and Block metadata checks the Test save and the Function save share.

REQ-3.1.2.4, REQ-3.1.3.13.
"""

from __future__ import annotations

import re
from typing import Any

from wavecore.core.execution.plugin_executor import (
    read_only_violation,
    template_read_only_violation,
)
from wavecore.core.variables.usage import field_text, reference_settings

READ_ONLY_CODE = "EXPRESSION_CHANGES_DATA"
REMOVE_BLOCK = "Remove block"
MAX_DESCRIPTION_LENGTH = 64

_SEMANTIC_VERSION = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)")


def error_entry(
    *,
    path: str,
    code: str,
    message: str,
    fix_action: str | None = None,
    node_id: str | None = None,
    node_label: str | None = None,
    element_type: str | None = None,
) -> dict[str, Any]:
    """One save error entry, in the shape every save check reports."""
    return {
        "path": path,
        "node_id": node_id,
        "node_label": node_label,
        "element_type": element_type,
        "code": code,
        "message": message,
        "severity": "error",
        "fix_action": fix_action,
    }


def block_type_registered(element_type: str, version: str, *, control: bool) -> bool:
    """Whether a plugin or control type is registered, so its declared fields can be read."""
    if control:
        from wavecore.controls.registry import get_control_implementation
        from wavecore.models.enums import ControlId

        try:
            control_id = ControlId(element_type)
        except ValueError:
            return False
        return get_control_implementation(control_id, version) is not None
    from wavecore.core.plugin_registry import get_plugin

    return get_plugin(element_type, version) is not None


def validate_node_element_type(
    node_path: str,
    node_id: str,
    node_label: str | None,
    element_type: str | None,
    all_known_element_types: set[str],
    errors: list[dict[str, Any]],
) -> bool:
    """Refuse a missing or unknown Block type; False means the Block's other checks are skipped."""
    if not element_type or not isinstance(element_type, str):
        errors.append(
            error_entry(
                path=f"{node_path}.data.elementType",
                node_id=node_id,
                node_label=node_label,
                code="MISSING_BLOCK_TYPE",
                message="Block must have an elementType",
                fix_action="Remove block (type unknown)",
            )
        )
        return False
    if element_type not in all_known_element_types:
        errors.append(
            error_entry(
                path=f"{node_path}.data.elementType",
                node_id=node_id,
                node_label=node_label,
                element_type=element_type,
                code="UNKNOWN_BLOCK_TYPE",
                message=f"Unknown block type: '{element_type}'",
                fix_action=REMOVE_BLOCK,
            )
        )
        return False
    return True


def validate_node_metadata(
    data: dict[str, Any],
    node_path: str,
    node_id: str,
    node_label: str | None,
    element_type: str,
    control_ids: set[str],
    errors: list[dict[str, Any]],
) -> None:
    """The nodeType key against the Block type, the name, the version and the description cap."""
    node_type_data = data.get("nodeType")
    is_control = element_type in control_ids
    expected_node_type = "control" if is_control else "plugin"
    # A Function Block's nodeType is 'function', compatible with any non-control type.
    if node_type_data == "function" and not is_control:
        node_type_data = None
    if node_type_data and node_type_data != expected_node_type:
        errors.append(
            error_entry(
                path=f"{node_path}.data.nodeType",
                node_id=node_id,
                node_label=node_label,
                element_type=element_type,
                code="NODE_TYPE_MISMATCH",
                message=(
                    f"nodeType '{node_type_data}' does not match elementType "
                    f"'{element_type}' (expected '{expected_node_type}')"
                ),
                fix_action=REMOVE_BLOCK,
            )
        )
    label = data.get("label")
    if not label or not isinstance(label, str) or not label.strip():
        errors.append(
            error_entry(
                path=f"{node_path}.data.label",
                node_id=node_id,
                node_label=node_label,
                element_type=element_type,
                code="MISSING_LABEL",
                message="Block must have a name",
                fix_action="Generate a name from the block type",
            )
        )
    version = data.get("version")
    if version and isinstance(version, str) and not _SEMANTIC_VERSION.match(version):
        errors.append(
            error_entry(
                path=f"{node_path}.data.version",
                node_id=node_id,
                node_label=node_label,
                element_type=element_type,
                code="INVALID_VERSION",
                message=f"Invalid semantic version: '{version}'",
                fix_action=REMOVE_BLOCK,
            )
        )
    description = data.get("description")
    if isinstance(description, str) and len(description) > MAX_DESCRIPTION_LENGTH:
        errors.append(
            error_entry(
                path=f"{node_path}.data.description",
                node_id=node_id,
                node_label=node_label,
                element_type=element_type,
                code="DESCRIPTION_TOO_LONG",
                message=f"Block description must be at most {MAX_DESCRIPTION_LENGTH} characters",
                fix_action=f"Trim description to {MAX_DESCRIPTION_LENGTH} characters",
            )
        )


def node_read_only_violations(data: dict[str, Any]) -> list[tuple[str, str]]:
    """(field name, reason) for every field of one Block that would change data."""
    config = data.get("config")
    values = config.get("values") if isinstance(config, dict) else None
    if not isinstance(values, dict):
        return []
    setter_values = values.get("variables")
    declared = [str(name) for name in data.get("expressionFields") or []]
    # The run reads a variable-naming setting as an expression, so the save checks it too.
    expression_names = [*declared, *sorted(reference_settings(data) - set(declared))]
    sources: list[tuple[Any, Any, Any]] = [
        (values, expression_names, read_only_violation),
        (values, data.get("templateFields"), template_read_only_violation),
        (setter_values, data.get("variableExpressionKeys"), read_only_violation),
        (setter_values, data.get("variableTemplateKeys"), template_read_only_violation),
    ]
    found: list[tuple[str, str]] = []
    reported: set[str] = set()
    for root, names, check in sources:
        for name in names or []:
            text = field_text(root, name)
            reason = check(text) if text else None
            if reason and str(name) not in reported:
                reported.add(str(name))
                found.append((str(name), reason))
    return found


def variable_read_only_violation(var_info: dict[str, Any]) -> str | None:
    """The reason a Variable Manager entry would change data, or None."""
    source = var_info.get("value")
    if not isinstance(source, str) or not source:
        return None
    if var_info.get("isExpression"):
        return read_only_violation(source)
    if var_info.get("isTemplate"):
        return template_read_only_violation(source)
    return None


def validate_read_only_expressions(
    nodes: list[dict[str, Any]],
    variables: dict[str, Any],
    errors: list[dict[str, Any]],
) -> None:
    """Refuse at save any author text that would change data; the run gate stays the backstop."""
    for node in nodes:
        data = node.get("data") or {}
        node_id = node.get("id", "")
        label = data.get("label") or node_id
        for field_name, reason in node_read_only_violations(data):
            errors.append(
                error_entry(
                    path=f"nodes.{node_id}.config.values.{field_name}",
                    node_id=node_id,
                    node_label=data.get("label"),
                    element_type=data.get("elementType"),
                    code=READ_ONLY_CODE,
                    message=f"{reason} Block: {label}. Field: {field_name}.",
                )
            )
    for var_name, var_info in variables.items():
        if not isinstance(var_info, dict):
            continue
        var_reason = variable_read_only_violation(var_info)
        if var_reason:
            errors.append(
                error_entry(
                    path=f"variables.{var_name}",
                    code=READ_ONLY_CODE,
                    message=f"{var_reason} Variable: {var_name}.",
                )
            )
