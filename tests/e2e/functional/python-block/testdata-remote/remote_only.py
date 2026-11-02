"""Reached by a plain relative path, resolved against the Working Directory on the remote host."""

import platform

PARTS = ["pyrem", "plain", "ok"]

plain_host = platform.node()
plain_mark = "-".join(PARTS)
print(plain_mark)
