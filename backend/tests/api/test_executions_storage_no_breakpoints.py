"""Unit tests asserting that the executions storage layer has no breakpoint persistence.

Debug state is ephemeral only: the execution storage module does not
reference breakpoint state. Every symbol listed below must be absent,
and nothing should attempt to read or write ``breakpoints.yaml``.
"""

from pathlib import Path

import pytest

_REMOVED_STORAGE_SYMBOLS = (
    "_execution_breakpoints",
    "_load_breakpoints",
    "_save_breakpoints",
    "_init_breakpoints_list",
)


class TestStorageModuleHasNoBreakpointSymbols:
    """``wavecore.api.services.executions._storage`` removes every breakpoint hook."""

    def test_removed_symbols_are_absent_from_module(self) -> None:
        """The breakpoint cache + file helpers are deleted."""
        from wavecore.api.services.executions import _storage

        for name in _REMOVED_STORAGE_SYMBOLS:
            assert not hasattr(
                _storage, name
            ), f"{name!r} must be removed from _storage.py for ephemeral-only debug"

    def test_breakpoints_yaml_constant_not_referenced_in_module_source(self) -> None:
        """The on-disk file name ``breakpoints.yaml`` is not referenced."""
        from wavecore.api.services.executions import _storage

        source_path = Path(_storage.__file__)
        source = source_path.read_text()
        assert (
            "breakpoints.yaml" not in source
        ), "the legacy breakpoints.yaml reference must be removed from _storage.py"

    def test_cache_loader_does_not_clear_breakpoint_cache(self) -> None:
        """``_ensure_cache_loaded`` does not clear ``_execution_breakpoints``."""
        from wavecore.api.services.executions import _storage

        source = Path(_storage.__file__).read_text(encoding="utf-8")
        assert "_execution_breakpoints.clear()" not in source


class TestDebugActionsServiceRemoved:
    """``debug_actions`` module is entirely deleted."""

    def test_debug_actions_module_not_importable(self) -> None:
        import importlib

        with pytest.raises(ModuleNotFoundError):
            importlib.import_module("wavecore.api.services.executions.debug_actions")


class TestCacheLifecycleStillWorksWithoutBreakpointHooks:
    """Cache reload helpers keep working after the breakpoint hooks are removed."""

    def test_clear_in_memory_cache_is_callable(self) -> None:
        """``_clear_in_memory_cache`` still exists and runs without error."""
        from wavecore.api.services.executions import _storage

        _storage._clear_in_memory_cache()  # Must not raise NameError on removed cache

    def test_clear_storage_is_callable(self) -> None:
        """``_clear_storage`` still exists and runs without error."""
        from wavecore.api.services.executions import _storage

        _storage._clear_storage()  # Must not raise NameError on removed cache
