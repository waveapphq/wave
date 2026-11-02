"""The variable types a value may be declared with (REQ-3.1.3.6)."""

from enum import Enum


class ReturnValueType(Enum):
    """Return value type enumeration."""

    STRING = "string"
    INTEGER = "integer"
    FLOAT = "float"
    BOOLEAN = "boolean"
    ARRAY = "array"
    MAP = "map"
    TABLE = "table"
    NULL = "null"
