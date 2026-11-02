"""
Block execution control logic.

Implements requirements:
- REQ-3.1.2.6: Optional log level override per block instance
"""

from wavecore.models.enums import LogLevel


def compute_effective_log_level(
    plugin_level: LogLevel | None,
    block_level: LogLevel | None,
    execution_level: LogLevel | None,
) -> LogLevel:
    """
    Compute the effective log level from three-layer filtering model (REQ-3.1.2.6).

    The effective log level is determined by the most restrictive (highest numeric value)
    of the three layers: plugin instance, block instance, and execution level.

    Args:
        plugin_level: Plugin instance log level threshold (or None for pass-through)
        block_level: Block instance log level threshold (or None for pass-through)
        execution_level: Execution-level log level threshold (or None for pass-through)

    Returns:
        LogLevel: Most restrictive log level from the three layers.
                  Returns DEBUG if all three are None (most permissive, all logs visible).

    Examples:
        >>> compute_effective_log_level(LogLevel.DEBUG, LogLevel.WARN, LogLevel.INFO)
        LogLevel.WARN  # Most restrictive

        >>> compute_effective_log_level(None, None, None)
        LogLevel.DEBUG  # All None = most permissive

        >>> compute_effective_log_level(LogLevel.INFO, LogLevel.NONE, LogLevel.DEBUG)
        LogLevel.NONE  # NONE always wins (suppresses all logs)
    """
    # Collect all non-None levels
    levels = [level for level in [plugin_level, block_level, execution_level] if level is not None]

    # If all are None, return most permissive (DEBUG)
    if not levels:
        return LogLevel.DEBUG

    # Return the most restrictive (highest numeric value)
    return max(levels)
