"""The one PEM-or-path reader every TLS consumer shares (REQ-5.1.4, REQ-3.4.1.6).

It also holds the home-relative path join the cores carried to a remote host share.
"""

import os

PEM_MARKER = "-----BEGIN"


def is_pem(material: str) -> bool:
    """Whether certificate material is inline PEM text rather than a path."""
    return PEM_MARKER in material


def from_home(path: str) -> str:
    """An absolute path unchanged; a relative one starts at this process user's home folder."""
    return os.path.join(os.path.expanduser("~"), path)


def read_pem(material: str) -> str:
    """Inline PEM unchanged; else the text of the file, a relative path starting from home."""
    if is_pem(material):
        return material
    with open(from_home(os.path.expanduser(material)), encoding="utf-8") as handle:
        return handle.read()
