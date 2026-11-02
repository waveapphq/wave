"""Helper module: sits beside main.py in Test Data, imported by name on the remote host."""

PREFIX = "pyrem"
KIND = "helper"


def tag(*parts):
    """A marker built from parts, so no script carries a marker verbatim."""
    return "-".join(parts)


def stamp():
    return tag(PREFIX, KIND, "ok")
