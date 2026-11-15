"""The values the run hands a control: the shared run fill over its declared fields."""

from typing import Any

from wavecore.controls.base import ControlBase
from wavecore.core.execution.plugin_executor import resolve_block_fields


def run_fill(
    control: ControlBase,
    stored: dict[str, Any],
    *,
    expression_fields: set[str] | None = None,
    variables: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """The stored values filled, resolved and checked the way the run hands them to the control."""
    return resolve_block_fields(
        stored,
        control.metadata["parameter_schema"],
        expression_fields=expression_fields or set(),
        template_fields=set(),
        element_types={},
        variables=variables or {},
        session_id=None,
        exact_numbers=False,
    )
