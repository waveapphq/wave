"""Render-time secret scope (REQ-3.1.3.5).

The run's registry, made reachable by a value that is being laid out for
display, so a cell is masked before its width is measured and before any cap
cuts it. Set once per block by the dispatcher; inert when nothing set it.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

from wavecore.core.secrets.registry import SecretRegistry

_render_scope: ContextVar[tuple[SecretRegistry, str | None] | None] = ContextVar(
    "wave_render_scope", default=None
)


@contextmanager
def render_scope(registry: SecretRegistry | None, block_id: str | None) -> Iterator[None]:
    """Bind the registry a value renders against for the duration of a block."""
    token = _render_scope.set(None if registry is None else (registry, block_id))
    try:
        yield
    finally:
        _render_scope.reset(token)


def active_scan_values() -> tuple[str, ...]:
    """Scrubbable value forms for the block currently rendering, longest first."""
    scope = _render_scope.get()
    if scope is None:
        return ()
    registry, block_id = scope
    return registry.scan_values(exclude_for_block=block_id)
