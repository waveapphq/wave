"""The standard-library count wording the Blocks and the remote bundle share."""


def plural(count: float, one: str, many: str) -> str:
    """A count with its noun, singular only for exactly one."""
    return f"{count} {one if count == 1 else many}"
