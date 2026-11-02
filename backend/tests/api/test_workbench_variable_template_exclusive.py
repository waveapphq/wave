"""Template / expression mutual-exclusivity for workbench variables (REQ-3.1.3.15).

A string value carries exactly one kind. The workbench variable shape gains
``isTemplate`` (mutually exclusive with ``isExpression``), mirroring
``BlockParameter.is_template`` / ``is_expression`` on the parameter side. The
gate lives in ``_flatten_variables`` (the variable-prep entry point that reads
the kind flags) and reuses the ``BlockParameter`` message.
"""

from __future__ import annotations

import pytest

from wavecore.api.exceptions import ValidationException
from wavecore.api.services.workbench import service as workbench_service


class TestVariableKindExclusivity:
    """An entry cannot declare both ``isExpression`` and ``isTemplate``."""

    def test_both_flags_raise_mutually_exclusive(self) -> None:
        with pytest.raises(
            ValidationException,
            match=r"^is_expression and is_template are mutually exclusive$",
        ):
            workbench_service._flatten_variables(
                {
                    "bad": {
                        "value": "Hi {{user}}",
                        "type": "string",
                        "isExpression": True,
                        "isTemplate": True,
                    }
                }
            )

    def test_expression_only_is_allowed(self) -> None:
        _literals, expr_map, tmpl_map = workbench_service._flatten_variables(
            {"derived": {"value": "1 + 1", "type": "integer", "isExpression": True}}
        )
        assert expr_map == {"derived": ("1 + 1", "integer")}
        assert tmpl_map == {}

    def test_template_only_is_allowed(self) -> None:
        _literals, expr_map, tmpl_map = workbench_service._flatten_variables(
            {"greeting": {"value": "Hi {{user}}", "type": "string", "isTemplate": True}}
        )
        assert tmpl_map == {"greeting": "Hi {{user}}"}
        assert expr_map == {}
