"""
Core business logic module for WAVE.

This module contains the core business logic components including
block version management and validation.
"""

from wavecore.core.blocks.validator import (
    BlockValidator,
    ValidationError,
    ValidationFeedback,
    ValidationIssue,
    ValidationSeverity,
)
from wavecore.core.blocks.version_manager import BlockVersionManager
from wavecore.core.table import ColumnType, Table, TableRowView

__all__ = [
    "BlockVersionManager",
    "BlockValidator",
    "ColumnType",
    "Table",
    "TableRowView",
    "ValidationError",
    "ValidationFeedback",
    "ValidationIssue",
    "ValidationSeverity",
]
