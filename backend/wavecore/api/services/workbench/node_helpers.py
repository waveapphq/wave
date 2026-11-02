"""Node field extraction, queue management, and node dispatch for workbench execution."""

from typing import Any

import wavecore.core.secrets.masking_settings as masking_settings
from wavecore.core.secrets.render_scope import render_scope
from wavecore.core.variables.element_types import realize_typed_settings


async def _execute_node(
    node_fields: dict[str, Any],
    variables: dict[str, Any],
    session_id: str,
    node_id: str,
) -> Any:
    """Dispatch execution to control or plugin handler.

    Used by both the main execution loop and try-catch path execution.
    """
    # The container is engine-dispatched, never a catalog plugin (REMEX-1).
    if node_fields["element_type"] == "remote-execution":
        return {"__remote_execution": True}

    # Late-bound import to avoid circular dependency
    import wavecore.api.services.workbench.plugins as _plugins

    reveal_secrets = masking_settings.resolve_block_reveal(
        node_fields.get("secret_masking", "system")
    )
    # A value laid out for display masks against this block's registry, not after.
    with render_scope(_plugins._get_session_registry(session_id), node_id):
        if node_fields["node_type"] == "control":
            return await _plugins._execute_control(
                node_fields["element_type"],
                node_fields["version"],
                node_fields["config_values"],
                variables,
                session_id=session_id,
                block_id=node_id,
                block_label=_stored_name(node_fields),
                expression_fields=node_fields["expression_fields"],
                template_fields=node_fields["template_fields"],
                setter_rows=_plugins.SetterRows(
                    expression_keys=node_fields["variable_expression_keys"],
                    template_keys=node_fields["variable_template_keys"],
                    types=node_fields["variable_types"],
                    element_types=node_fields["variable_element_types"],
                ),
                reveal_secrets=reveal_secrets,
            )
        if node_fields["node_type"] == "plugin":
            result = await _execute_plugin_node(
                node_fields, variables, session_id, node_id, reveal_secrets
            )
            _plugins._register_secret_outputs(node_fields, result, session_id)
            return result
        if node_fields["node_type"] == "function":
            from wavecore.api.services.workbench.functions import handle_function_node

            return await handle_function_node(node_fields, variables, session_id, node_id)
        return None


async def _execute_plugin_node(
    node_fields: dict[str, Any],
    variables: dict[str, Any],
    session_id: str,
    node_id: str,
    reveal_secrets: bool,
) -> Any:
    """Run a plugin block where it runs: inside a Remote Execution body a remotable
    block goes to the innermost body's worker (REMEX-1), everything else runs on WAVE."""
    import wavecore.api.services.workbench.plugins as _plugins
    import wavecore.api.services.workbench.remote_exec as _remote_exec

    body_worker = _remote_exec.active_body_worker()
    if body_worker is not None and _remote_exec.is_remotable(
        node_fields["element_type"], node_fields["version"]
    ):
        return await _remote_exec.run_on_body_worker(
            body_worker, node_fields, variables, session_id, node_id
        )
    return await _plugins._execute_plugin(
        node_fields["element_type"],
        node_fields["version"],
        node_fields["config_values"],
        variables,
        session_id=session_id,
        block_id=node_id,
        block_label=_stored_name(node_fields),
        expression_fields=node_fields["expression_fields"],
        template_fields=node_fields["template_fields"],
        reveal_secrets=reveal_secrets,
        unmasked_secret_fields=node_fields.get("unmasked_secret_fields", []),
        output_secret_fields=node_fields.get("output_secret_fields"),
        output_bindings=node_fields["output_bindings"],
    )


def _stored_name(node_fields: dict[str, Any]) -> str | None:
    """The block's Name as stored; ``block_name`` turns an absent one into "Unknown"."""
    label: str | None = node_fields["node_data"].get("label")
    return label


def _extract_node_fields(node: dict[str, Any]) -> dict[str, Any]:
    """Extract commonly-used fields from a workflow node into a flat dict."""
    node_data = node.get("data", {})
    expression_fields = set(node_data.get("expressionFields", []))
    return {
        "node_data": node_data,
        "block_name": node_data.get("label", "Unknown"),
        "node_type": node_data.get("nodeType"),
        "element_type": node_data.get("elementType"),
        "version": node_data.get("version", "1.0.0"),
        "config_values": realize_typed_settings(
            node_data.get("config", {}).get("values", {}),
            node_data.get("elementTypes"),
            expression_fields,
        ),
        "expression_fields": expression_fields,
        "template_fields": set(node_data.get("templateFields", [])),
        "variable_expression_keys": set(node_data.get("variableExpressionKeys", [])),
        "variable_template_keys": set(node_data.get("variableTemplateKeys", [])),
        "variable_types": node_data.get("variableTypes", {}),
        "variable_element_types": node_data.get("variableElementTypes", {}),
        "output_bindings": node_data.get("config", {}).get("outputBindings", {}),
        "secret_masking": node_data.get("config", {}).get("secret_masking", "system"),
        "unmasked_secret_fields": list(
            node_data.get("config", {}).get("unmasked_secret_fields", [])
        ),
        # Absent stays None (schema-seed fallback); a present list is the complete truth.
        "output_secret_fields": (
            None
            if node_data.get("config", {}).get("outputSecretFields") is None
            else list(node_data.get("config", {}).get("outputSecretFields"))
        ),
    }


def _enqueue_children(
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]],
    executed: set[str],
    exec_queue: list[str],
) -> None:
    """Enqueue all children of a node that have not yet been executed."""
    for child_id, _h in adj.get(node_id, []):
        if child_id not in executed:
            exec_queue.append(child_id)
