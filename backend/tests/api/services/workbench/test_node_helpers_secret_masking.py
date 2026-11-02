"""Per-block run-output masking control extraction + dispatch (REQ-3.1.3.5).

The per-node `unmask_secrets` bool is replaced by a tri-state
`config.secret_masking` = "system" | "reveal" | "mask" (no back-compat; WAVE v1):
- `_extract_node_fields` emits `secret_masking` (str, default "system").
- `_execute_node` resolves the effective run-output reveal via
  `masking_settings.resolve_block_reveal` and forwards it as `reveal_secrets`
  (bool) to the control/plugin executor.
"""

from collections.abc import Generator
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

import wavecore.core.secrets.masking_settings as masking_settings
from wavecore.api.services.workbench.node_helpers import (
    _execute_node,
    _extract_node_fields,
)


@pytest.fixture(autouse=True)
def _reset_reveal_settings() -> Generator[None, None, None]:
    masking_settings.set_reveal_settings(
        run_output=False, test_variables=False, shared_variables=False
    )
    yield
    masking_settings.set_reveal_settings(
        run_output=False, test_variables=False, shared_variables=False
    )


def _plugin_node(secret_masking: str | None = None) -> dict[str, Any]:
    config: dict[str, Any] = {"values": {}, "outputBindings": {}}
    if secret_masking is not None:
        config["secret_masking"] = secret_masking
    return {
        "id": "node-1",
        "type": "workflowNode",
        "data": {
            "label": "HTTP",
            "elementType": "http-client",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": config,
        },
    }


def _control_node(secret_masking: str) -> dict[str, Any]:
    return {
        "id": "node-c",
        "type": "workflowNode",
        "data": {
            "label": "Delay",
            "elementType": "delay",
            "nodeType": "control",
            "version": "1.0.0",
            "config": {"values": {}, "secret_masking": secret_masking},
        },
    }


class TestExtractSecretMasking:
    """`_extract_node_fields` reads the tri-state as a string, default 'system'."""

    def test_extract_reveal_setting(self) -> None:
        fields = _extract_node_fields(_plugin_node("reveal"))
        assert fields["secret_masking"] == "reveal"

    def test_extract_mask_setting(self) -> None:
        fields = _extract_node_fields(_plugin_node("mask"))
        assert fields["secret_masking"] == "mask"

    def test_extract_defaults_to_system_when_absent(self) -> None:
        fields = _extract_node_fields(_plugin_node(None))
        assert fields["secret_masking"] == "system"


class TestExecuteNodeForwardsResolvedReveal:
    """`_execute_node` forwards the RESOLVED reveal bool, not the raw setting."""

    @pytest.mark.asyncio
    async def test_reveal_setting_forwards_true_to_plugin(self) -> None:
        fields = _extract_node_fields(_plugin_node("reveal"))
        with patch(
            "wavecore.api.services.workbench.plugins._execute_plugin",
            new=AsyncMock(return_value=None),
        ) as mock_plugin:
            await _execute_node(fields, {}, "s-1", "node-1")
            assert mock_plugin.call_args.kwargs["reveal_secrets"] is True

    @pytest.mark.asyncio
    async def test_mask_setting_forwards_false_to_plugin(self) -> None:
        fields = _extract_node_fields(_plugin_node("mask"))
        with patch(
            "wavecore.api.services.workbench.plugins._execute_plugin",
            new=AsyncMock(return_value=None),
        ) as mock_plugin:
            await _execute_node(fields, {}, "s-1", "node-1")
            assert mock_plugin.call_args.kwargs["reveal_secrets"] is False

    @pytest.mark.asyncio
    async def test_system_setting_follows_masked_system_default(self) -> None:
        fields = _extract_node_fields(_plugin_node("system"))
        with patch(
            "wavecore.api.services.workbench.plugins._execute_plugin",
            new=AsyncMock(return_value=None),
        ) as mock_plugin:
            await _execute_node(fields, {}, "s-1", "node-1")
            assert mock_plugin.call_args.kwargs["reveal_secrets"] is False

    @pytest.mark.asyncio
    async def test_system_setting_follows_revealed_system_default(self) -> None:
        masking_settings.set_reveal_settings(run_output=True)
        fields = _extract_node_fields(_plugin_node("system"))
        with patch(
            "wavecore.api.services.workbench.plugins._execute_plugin",
            new=AsyncMock(return_value=None),
        ) as mock_plugin:
            await _execute_node(fields, {}, "s-1", "node-1")
            assert mock_plugin.call_args.kwargs["reveal_secrets"] is True

    @pytest.mark.asyncio
    async def test_reveal_setting_forwards_true_to_control(self) -> None:
        fields = _extract_node_fields(_control_node("reveal"))
        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new=AsyncMock(return_value=None),
        ) as mock_control:
            await _execute_node(fields, {}, "s-1", "node-c")
            assert mock_control.call_args.kwargs["reveal_secrets"] is True
