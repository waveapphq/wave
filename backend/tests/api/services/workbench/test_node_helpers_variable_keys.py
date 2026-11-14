"""A Variable Setter's rows reach the run on the shared field flags (REQ-3.4.1.14).

The node's own `expressionFields` / `templateFields` carry its rows (`variables.<row>`) and
entries (`variables.<row>.<entry>`); the extracted node fields hold no Setter-only record and
the control call gets none.
"""

import inspect
from typing import Any
from unittest.mock import AsyncMock, patch

from wavecore.api.services.workbench import plugins as _wb_plugins
from wavecore.api.services.workbench.node_helpers import (
    _execute_node,
    _extract_node_fields,
)

_SETTER_ONLY_KEYS = {
    "variable_expression_keys",
    "variable_template_keys",
    "variable_types",
    "variable_element_types",
}


def _make_setter_node() -> dict[str, Any]:
    """A Variable Setter node on the shared stored shape: rows and entries flagged by place."""
    return {
        "id": "node-1",
        "type": "workflowNode",
        "data": {
            "label": "Set Vars",
            "elementType": "variable-setter",
            "nodeType": "control",
            "version": "1.0.0",
            "config": {
                "values": {
                    "variables": {
                        "next_attempt": "attempt + 1",
                        "summary": "Run {{ run_id }} done",
                        "host_list": ["web-1", "web-2", "backup_host"],
                    }
                },
                "outputBindings": {},
            },
            "expressionFields": ["variables.next_attempt", "variables.host_list.2"],
            "templateFields": ["variables.summary"],
            "elementTypes": {"variables.host_list": ["string", "string", "string"]},
        },
    }


def test_extract_node_fields_carries_no_setter_keys() -> None:
    fields = _extract_node_fields(_make_setter_node())

    assert _SETTER_ONLY_KEYS.isdisjoint(fields)
    assert fields["expression_fields"] == {"variables.next_attempt", "variables.host_list.2"}
    assert fields["template_fields"] == {"variables.summary"}


async def test_execute_node_passes_setter_flags_through_expression_fields() -> None:
    fields = _extract_node_fields(_make_setter_node())
    execute_control = _wb_plugins._execute_control
    with patch(
        "wavecore.api.services.workbench.plugins._execute_control",
        new=AsyncMock(return_value=None),
    ) as mock_control:
        await _execute_node(fields, {"attempt": 1, "run_id": "r-1"}, "s-1", "node-1")

    mock_control.assert_awaited_once()
    sent = (
        inspect.signature(execute_control)
        .bind(*mock_control.call_args.args, **mock_control.call_args.kwargs)
        .arguments
    )
    assert "setter_rows" not in sent
    assert sent["expression_fields"] == {"variables.next_attempt", "variables.host_list.2"}
    assert sent["template_fields"] == {"variables.summary"}
