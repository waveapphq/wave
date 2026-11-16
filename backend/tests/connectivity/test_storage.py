"""
Tests for File-Based Storage Initialization
"""

from wavecore.storage.file_storage import FileBasedStorage


class TestFileBasedStorageInitialization:
    """Test FileBasedStorage initialization."""

    def test_init_with_base_path(self, tmp_path):
        """Test initialization with base_path parameter."""
        storage = FileBasedStorage(base_path=tmp_path)
        assert storage.base_path == tmp_path
