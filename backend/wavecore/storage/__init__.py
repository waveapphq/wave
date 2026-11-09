"""
WAVE Storage Layer

Reads plugin definitions from the data folder (REQ-6.1.1).
"""

from .file_storage import FileBasedStorage

__all__ = ["FileBasedStorage"]
