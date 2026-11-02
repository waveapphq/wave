"""Per-variable atomic access for the live variables dict.

Parallel branches share one variables dict. Every execution-path read and write
goes through this layer so a reader never observes a half-written value: reads
of one variable proceed together, a write excludes readers of that variable for
its duration, and access is per variable so work on one never delays another.

The guarantee lives here rather than in ambient runtime behavior, so a Python
build without the GIL changes only the primitive below.
"""

from collections.abc import AsyncIterator, Iterable
from contextlib import asynccontextmanager
from typing import Any


class _ReaderWriterGuard:
    """One variable's reader/writer guard: shared reads, exclusive writes."""

    def __init__(self) -> None:
        import asyncio

        self._condition = asyncio.Condition()
        self._readers = 0
        self._writing = False

    async def acquire_read(self) -> None:
        async with self._condition:
            await self._condition.wait_for(lambda: not self._writing)
            self._readers += 1

    async def release_read(self) -> None:
        async with self._condition:
            self._readers -= 1
            if self._readers == 0:
                self._condition.notify_all()

    async def acquire_write(self) -> None:
        async with self._condition:
            await self._condition.wait_for(lambda: not self._writing and self._readers == 0)
            self._writing = True

    async def release_write(self) -> None:
        async with self._condition:
            self._writing = False
            self._condition.notify_all()


class VariableAccess:
    """Guarded access to a shared variables dict.

    The dict is held live, never copied: a value written through this layer is
    immediately the value every other holder of the same dict reads.
    """

    def __init__(self, variables: dict[str, Any]) -> None:
        self._variables = variables
        self._guards: dict[str, _ReaderWriterGuard] = {}

    @property
    def variables(self) -> dict[str, Any]:
        """The live dict this layer guards."""
        return self._variables

    def _guard(self, name: str) -> _ReaderWriterGuard:
        guard = self._guards.get(name)
        if guard is None:
            guard = _ReaderWriterGuard()
            self._guards[name] = guard
        return guard

    def assign(self, name: str, value: Any) -> None:
        """Store a value without suspending.

        The walker's output-binding step holds nothing exclusively and does not
        await between check and store, so this assignment is indivisible. A
        runtime with real threads replaces this body, never its call sites.
        """
        self._variables[name] = value

    async def read(self, name: str) -> Any:
        """Return the variable's value, waiting out any write in flight."""
        guard = self._guard(name)
        await guard.acquire_read()
        try:
            return self._variables[name]
        finally:
            await guard.release_read()

    async def write(self, name: str, value: Any) -> None:
        """Store a value, excluding readers of that variable for the write."""
        async with self.update([name]) as held:
            held[name] = value

    @asynccontextmanager
    async def update(self, names: Iterable[str]) -> AsyncIterator[dict[str, Any]]:
        """Hold every named variable exclusively and yield the live dict."""
        # Sorted acquisition: two branches naming the same variables in opposite
        # author order still take them in one order, so neither can deadlock.
        ordered = sorted(set(names))
        acquired: list[_ReaderWriterGuard] = []
        try:
            for name in ordered:
                guard = self._guard(name)
                await guard.acquire_write()
                acquired.append(guard)
            yield self._variables
        finally:
            for guard in reversed(acquired):
                await guard.release_write()


def session_variable_access(
    session: dict[str, Any] | None, variables: dict[str, Any]
) -> VariableAccess:
    """The one access layer a run shares, so sibling branches share its guards."""
    if session is None:
        return VariableAccess(variables)
    access = session.get("_variable_access")
    if not isinstance(access, VariableAccess) or access.variables is not variables:
        access = VariableAccess(variables)
        session["_variable_access"] = access
    return access
