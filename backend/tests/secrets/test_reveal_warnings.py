"""Run-start and pre-block secret-reveal warnings (REQ-3.1.3.5).

A run that contains effective-revealing blocks warns once at run start naming
them (scan recurses Function bodies), and once immediately before each such
block executes. Both warnings fall silent when run output is revealed
system-wide (every block is already exposed, so the warnings would be noise).

The scan and the run-start WARN live in `workbench/execution.py`; the pre-block WARN
lives in the shared Block step of `workbench/_common.py`.
"""

from collections.abc import Generator
from typing import Any

import pytest

import wavecore.api.services.workbench._common as workbench_common
import wavecore.api.services.workbench.execution as execution
import wavecore.core.secrets.masking_settings as masking_settings

_RUN_START_PREFIX = "Secret masking bypassed for "
_RUN_START_SUFFIX = ". Secret values appear in cleartext in this run's logs and reports."
_PRE_BLOCK = (
    "Secret masking bypassed for this block - "
    "secret values appear in cleartext in its logs and reports."
)


def _run_start(count: int, names: str) -> str:
    return f"{_RUN_START_PREFIX}{count} block(s): {names}{_RUN_START_SUFFIX}"


def _plugin(name: str, setting: str | None = None) -> dict[str, Any]:
    """A plugin node named `name`, optionally carrying a `secret_masking` choice."""
    data: dict[str, Any] = {"nodeType": "plugin", "label": name}
    if setting is not None:
        data["config"] = {"secret_masking": setting}
    return {"id": name, "type": "workflowNode", "data": data}


def _control(name: str, setting: str) -> dict[str, Any]:
    """A control node - never carries the per-block run-output control."""
    return {
        "id": name,
        "type": "workflowNode",
        "data": {"nodeType": "control", "label": name, "config": {"secret_masking": setting}},
    }


def _function_with_body(body_nodes: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": "fn-1",
        "type": "workflowNode",
        "data": {
            "nodeType": "function",
            "label": "Fn",
            "localDefinition": {"workflow": {"nodes": body_nodes}},
        },
    }


@pytest.fixture(autouse=True)
def _reset_reveal_settings() -> Generator[None, None, None]:
    masking_settings.set_reveal_settings(
        run_output=False, test_variables=False, shared_variables=False
    )
    yield
    masking_settings.set_reveal_settings(
        run_output=False, test_variables=False, shared_variables=False
    )


class TestCollectRevealingBlocks:
    """The run-start scan names blocks whose effective run-output is revealing."""

    def test_always_reveal_block_is_collected(self) -> None:
        assert execution._collect_revealing_blocks([_plugin("HTTP", "reveal")]) == ["HTTP"]

    def test_always_mask_block_is_never_collected(self) -> None:
        assert execution._collect_revealing_blocks([_plugin("HTTP", "mask")]) == []

    def test_system_block_is_not_collected_when_system_masked(self) -> None:
        assert execution._collect_revealing_blocks([_plugin("HTTP", "system")]) == []

    def test_absent_setting_defaults_to_system(self) -> None:
        assert execution._collect_revealing_blocks([_plugin("HTTP")]) == []

    def test_system_block_is_collected_when_system_revealed(self) -> None:
        masking_settings.set_reveal_settings(run_output=True)
        assert execution._collect_revealing_blocks([_plugin("HTTP", "system")]) == ["HTTP"]

    def test_mask_block_stays_out_even_when_system_revealed(self) -> None:
        masking_settings.set_reveal_settings(run_output=True)
        nodes = [_plugin("A", "mask"), _plugin("B", "system")]
        assert execution._collect_revealing_blocks(nodes) == ["B"]

    def test_mixed_settings_collect_only_reveal_when_system_masked(self) -> None:
        nodes = [_plugin("R", "reveal"), _plugin("M", "mask"), _plugin("S", "system")]
        assert execution._collect_revealing_blocks(nodes) == ["R"]

    def test_control_node_is_ignored(self) -> None:
        assert execution._collect_revealing_blocks([_control("Delay", "reveal")]) == []

    def test_scan_recurses_into_function_bodies(self) -> None:
        nodes = [_function_with_body([_plugin("Inner", "reveal")])]
        assert execution._collect_revealing_blocks(nodes) == ["Inner"]

    def test_document_order_is_preserved(self) -> None:
        nodes = [_plugin("First", "reveal"), _plugin("Second", "reveal")]
        assert execution._collect_revealing_blocks(nodes) == ["First", "Second"]


class TestRunStartWarning:
    """One WARN at run start, naming the revealing block(s)."""

    def test_single_revealing_block_message(self) -> None:
        result = execution._run_start_reveal_warning([_plugin("HTTP", "reveal")])
        assert result == _run_start(1, "HTTP")

    def test_multiple_revealing_blocks_message(self) -> None:
        nodes = [_plugin("HTTP", "reveal"), _plugin("Login", "reveal")]
        result = execution._run_start_reveal_warning(nodes)
        assert result == _run_start(2, "HTTP, Login")

    def test_no_warning_when_nothing_reveals(self) -> None:
        nodes = [_plugin("A", "mask"), _plugin("B", "system")]
        assert execution._run_start_reveal_warning(nodes) is None

    def test_function_nested_revealing_block_is_named(self) -> None:
        nodes = [_function_with_body([_plugin("Inner", "reveal")])]
        assert execution._run_start_reveal_warning(nodes) == _run_start(1, "Inner")

    def test_suppressed_when_run_output_revealed_system_wide(self) -> None:
        masking_settings.set_reveal_settings(run_output=True)
        assert execution._run_start_reveal_warning([_plugin("HTTP", "system")]) is None

    def test_always_reveal_block_still_suppressed_under_system_reveal(self) -> None:
        masking_settings.set_reveal_settings(run_output=True)
        assert execution._run_start_reveal_warning([_plugin("HTTP", "reveal")]) is None


class TestPreBlockWarning:
    """One WARN immediately before each effective-revealing block executes."""

    def test_reveal_block_warns_when_system_masked(self) -> None:
        assert workbench_common._pre_block_reveal_warning("reveal") == _PRE_BLOCK

    def test_mask_block_never_warns(self) -> None:
        assert workbench_common._pre_block_reveal_warning("mask") is None

    def test_system_block_does_not_warn_when_system_masked(self) -> None:
        assert workbench_common._pre_block_reveal_warning("system") is None

    def test_system_block_suppressed_when_system_revealed(self) -> None:
        masking_settings.set_reveal_settings(run_output=True)
        assert workbench_common._pre_block_reveal_warning("system") is None

    def test_reveal_block_suppressed_when_system_revealed(self) -> None:
        masking_settings.set_reveal_settings(run_output=True)
        assert workbench_common._pre_block_reveal_warning("reveal") is None
