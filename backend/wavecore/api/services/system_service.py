"""System information service for application metadata (REQ-5.2.1.42).

This module provides read-only access to application version, build
information, runtime details, and support links for the Settings About tab.
"""

import os
import sys
from typing import Any

from wavecore import __version__


def get_system_info() -> dict[str, Any]:
    """Get system information for About tab.

    Returns:
        Dictionary containing:
        - version: Application version (semver)
        - build: Git commit hash or build identifier
        - build_date: ISO 8601 date of build
        - runtime: Runtime info (Python version)
        - support: Support links (docs, issues, contact)
    """
    return {
        "version": __version__,
        "build": _get_build_identifier(),
        "build_date": _get_build_date(),
        "runtime": {
            "python_version": _get_python_version(),
            "os": _get_os_name(),
            "os_version": _get_os_version(),
        },
        "support": {
            "documentation_url": "https://github.com/waveapphq/wave#readme",
            "issues_url": "https://github.com/waveapphq/wave/issues",
            "contact_email": "support@waveapp.dev",
        },
    }


def _get_build_identifier() -> str:
    """Get build identifier from environment or default.

    Returns:
        Build identifier (git commit hash or default)
    """
    return os.environ.get("WAVE_BUILD_ID", "dev")


def _get_build_date() -> str:
    """Get build date from environment or default.

    Returns:
        Build date in ISO 8601 format
    """
    return os.environ.get("WAVE_BUILD_DATE", "2025-01-01T00:00:00Z")


def _get_python_version() -> str:
    """Get Python runtime version.

    Returns:
        Python version string
    """
    return f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"


def _get_os_name() -> str:
    """Get operating system name.

    Returns:
        OS name (Linux, Darwin, Windows)
    """
    import platform

    return platform.system()


def _get_os_version() -> str:
    """Get operating system version.

    Returns:
        OS version string
    """
    import platform

    return platform.release()
