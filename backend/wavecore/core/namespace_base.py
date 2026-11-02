"""Base class for immutable namespace objects with attribute access.

Provides shared container protocol methods (__contains__, __len__, __eq__,
__bool__) and table-formatted string representation. Subclasses only need
to define __getattr__, __setattr__, __delattr__, and the __str__ header.
"""


class NamespaceObjectBase:
    """Mixin base for immutable namespace objects.

    Subclasses must define ``_data`` in ``__slots__`` and set it via
    ``object.__setattr__`` in ``__init__``.
    """

    _data: dict[str, object]

    def get_values(self) -> dict[str, object]:
        """Return a dict copy of all field values."""
        return dict(self._data)

    def get_params(self) -> list[str]:
        """Return list of field names."""
        return list(self._data.keys())

    def _str_header(self) -> str:
        """Return the header line for __str__. Subclasses override this."""
        return "Namespace"

    def __str__(self) -> str:
        """Table-formatted string representation."""
        header = self._str_header()
        if not self._data:
            return f"{header}\n  (empty)"
        max_key = max(len(k) for k in self._data)
        col_w = max(max_key, 5)
        lines = [header]
        lines.append(f"  {'Field':<{col_w}}  Value")
        lines.append(f"  {'-' * col_w}  {'-' * 30}")
        for k, v in self._data.items():
            lines.append(f"  {k:<{col_w}}  {v}")
        return "\n".join(lines)

    def __repr__(self) -> str:
        return self.__str__()

    def __contains__(self, key: object) -> bool:
        return key in self._data

    def __len__(self) -> int:
        return len(self._data)

    def __eq__(self, other: object) -> bool:
        if type(other) is type(self) and isinstance(other, NamespaceObjectBase):
            return self._data == other._data
        return NotImplemented

    def __bool__(self) -> bool:
        return True


def is_engine_injected(name: str, value: object) -> bool:
    """Namespace objects and dotted aliases are expression machinery, not user variables."""
    return "." in name or isinstance(value, NamespaceObjectBase)
