"""The one PEM-or-path reader every TLS consumer shares (REQ-5.1.4, REQ-3.4.1.6)."""

import os

PEM_MARKER = "-----BEGIN"


def is_pem(material: str) -> bool:
    """Whether certificate material is inline PEM text rather than a path."""
    return PEM_MARKER in material


def read_pem(material: str) -> str:
    """Inline PEM unchanged; else the text of the file, a relative path starting from home."""
    if is_pem(material):
        return material
    path = os.path.join(os.path.expanduser("~"), os.path.expanduser(material))
    with open(path, encoding="utf-8") as handle:
        return handle.read()
