"""
WAVE Storage Layer

Provides storage interface and file-based implementation for:
- REQ-6.1.1: YAML/JSON test definitions
- REQ-6.1.2: Versioned component files
- REQ-6.1.4: Artifact directory structure
- REQ-6.1.5: Configuration file hierarchy
"""

from .file_storage import FileBasedStorage
from .interface import StorageInterface

__all__ = ["StorageInterface", "FileBasedStorage"]
