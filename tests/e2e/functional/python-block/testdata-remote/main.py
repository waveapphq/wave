"""Read on WAVE from Test Data, shipped as source, and run on the remote host (PYRUN-2).

`readings` and `unit_price` are Input Variables of the block; `pyhelper` sits beside this
file in Test Data and is imported by name from the Working Directory on the remote host.
"""

import platform
import sys

import pyhelper

py_version = ".".join(str(part) for part in sys.version_info[:3])
py_host = platform.node()
py_rows = readings
py_price = unit_price * 3
py_list = [pyhelper.tag("row", "count"), len(readings), True]
py_map = {
    "host": py_host,
    "names": ",".join(row["name"] for row in readings),
    "first_temp": str(readings[0]["temp_c"]),
    "cell_kind": type(readings[0]["temp_c"]).__name__,
}

print(pyhelper.tag(pyhelper.PREFIX, "version") + " " + py_version)
print(pyhelper.stamp())
print(pyhelper.tag(pyhelper.PREFIX, "where") + " " + py_host)
