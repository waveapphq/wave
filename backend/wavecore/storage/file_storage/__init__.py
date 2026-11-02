"""
File-Based Storage Package

Re-exports from storage module for convenient access.
"""

from wavecore.storage.file_storage.storage import (  # noqa: F401
    PLUGIN_CATEGORIES,
    FileBasedStorage,
)

__all__ = ["FileBasedStorage", "PLUGIN_CATEGORIES"]
