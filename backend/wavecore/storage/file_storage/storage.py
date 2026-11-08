"""
File-Based Storage Implementation

Reads plugin definitions stored as versioned YAML files.
"""

from pathlib import Path

import yaml
from packaging import version as pkg_version

from wavecore.models.plugins import Plugin

PLUGIN_CATEGORIES = [
    "network",
    "remote",
    "database",
    "system",
    "kubernetes",
    "helm",
    "data",
    "custom",
]


class FileBasedStorage:
    """
    File-based storage implementation (REQ-6.1.1).

    Directory structure:
    base_path/
        plugins/
            {category}/
                {plugin_id}/
                    {version}.yaml
    """

    def __init__(self, base_path: Path):
        """Initialize file-based storage."""
        self.base_path = base_path

    def load_plugin(self, plugin_id: str) -> Plugin:
        """Load the latest version of a plugin from whichever category holds it."""
        for category in PLUGIN_CATEGORIES:
            plugin_dir = self.base_path / "plugins" / category / plugin_id
            versions = [f.stem for f in plugin_dir.glob("*.yaml")]
            if versions:
                latest = max(versions, key=pkg_version.parse)
                with open(plugin_dir / f"{latest}.yaml", encoding="utf-8") as f:
                    return Plugin(**yaml.safe_load(f))

        raise FileNotFoundError(f"Plugin not found: {plugin_id}")
