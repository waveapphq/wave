"""
WAVE Control System.

Control registration infrastructure for flow control constructs.

Requirements implemented:
- REQ-3.5.0.10: Control base class with metadata declaration
- REQ-3.5.0.11: Control registry for runtime version lookup
- REQ-3.5.0.12: Control registration at application startup
"""

from wavecore.controls.base import ControlBase
from wavecore.controls.registry import (
    ControlImplementationRegistry,
    DuplicateControlVersionError,
    InvalidControlMetadataError,
    clear_control_registry,
    get_control_implementation,
    register_all_core_controls,
)

__all__ = [
    "ControlBase",
    "ControlImplementationRegistry",
    "DuplicateControlVersionError",
    "InvalidControlMetadataError",
    "clear_control_registry",
    "get_control_implementation",
    "register_all_core_controls",
]
