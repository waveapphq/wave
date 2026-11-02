"""Render-time secret scope (REQ-3.1.3.5).

A value laid out for display is masked BEFORE its width is measured and before
any cap cuts it, so no alignment can disclose a protected value's length and no
cut can leave a prefix the downstream scrub can no longer match.
"""

import asyncio

import pytest

from wavecore.core.secrets.masking import mask_text
from wavecore.core.secrets.registry import SecretRegistry
from wavecore.core.secrets.render_scope import active_scan_values, render_scope
from wavecore.core.table import Table

_SECRET = "s3cr3t-" + "v" * 20


def _registry(value: str = _SECRET) -> SecretRegistry:
    registry = SecretRegistry()
    registry.register("token", value, "declared")
    return registry


def _token_table(value: str = _SECRET) -> Table:
    table = Table(columns=["Name", "Token"])
    table.add_row(["payments-api", value])
    return table


class TestScopeDefaultsInert:
    """With no scope active the hook is a no-op and rendering is unchanged."""

    def test_active_scan_values_is_empty_without_a_scope(self) -> None:
        assert active_scan_values() == ()

    def test_table_renders_raw_without_a_scope(self) -> None:
        assert _SECRET in str(_token_table())

    def test_none_registry_clears_the_scope(self) -> None:
        with render_scope(_registry(), "block-1"), render_scope(None, "block-1"):
            assert active_scan_values() == ()


class TestScopeMasksAtRenderTime:
    """Inside a scope every cell is masked while it is being rendered."""

    def test_cell_masks_inside_the_scope(self) -> None:
        with render_scope(_registry(), "block-1"):
            result = str(_token_table())

        assert "********" in result
        assert "s3cr3t" not in result

    def test_length_is_not_inferable_from_the_layout(self) -> None:
        """The same table with a 12-character and a 1200-character secret in the
        same cell renders byte-identically: the column is as wide as the mask."""
        short = "s3cr3t-short"
        long = "s3cr3t-" + "v" * 1193

        with render_scope(_registry(short), "block-1"):
            short_render = str(_token_table(short))
        with render_scope(_registry(long), "block-1"):
            long_render = str(_token_table(long))

        assert short_render == long_render

    def test_value_registered_after_scope_entry_is_still_masked(self) -> None:
        """The scope holds the registry, not a snapshot: a plugin that registers
        a secret mid-block (K8s Secret data) is covered by the same render."""
        registry = SecretRegistry()
        with render_scope(registry, "block-1"):
            registry.register("token", _SECRET, "declared")
            result = str(_token_table())

        assert "s3cr3t" not in result

    def test_scope_restores_on_exit(self) -> None:
        registry = _registry()
        outer = registry.scan_values()
        with render_scope(registry, None):
            assert active_scan_values() == outer
            with render_scope(SecretRegistry(), None):
                assert active_scan_values() == ()
            assert active_scan_values() == outer

        assert active_scan_values() == ()

    def test_downstream_scrub_is_a_no_op_over_the_rendered_table(self) -> None:
        registry = _registry()
        with render_scope(registry, "block-1"):
            rendered = str(_token_table())

        assert mask_text(rendered, registry.scan_values()) == rendered

    @pytest.mark.asyncio
    async def test_scope_survives_a_thread_hop(self) -> None:
        """Plugins render off-loop via asyncio.to_thread, which copies the context."""
        with render_scope(_registry(), "block-1"):
            result = await asyncio.to_thread(str, _token_table())

        assert "s3cr3t" not in result


class TestPerBlockExemption:
    """A block's own per-field reveal shows its own cells; protection still wins."""

    def test_exempt_block_renders_raw_and_other_blocks_mask(self) -> None:
        registry = SecretRegistry()
        registry.register_value(_SECRET, "reveal", exempt_block="block-1")

        with render_scope(registry, "block-1"):
            own = str(_token_table())
        with render_scope(registry, "block-2"):
            other = str(_token_table())

        assert _SECRET in own
        assert "s3cr3t" not in other

    def test_plain_registration_beats_an_exemption(self) -> None:
        registry = SecretRegistry()
        registry.register_value(_SECRET, "declared")
        registry.register_value(_SECRET, "reveal", exempt_block="block-1")

        with render_scope(registry, "block-1"):
            result = str(_token_table())

        assert "s3cr3t" not in result
