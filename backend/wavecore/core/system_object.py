"""Immutable system object with attribute access for expression evaluation.

Injected into the variable context at ``variables["system"]`` so that
``eval("system.field")`` resolves via ``__getattr__``.
"""

from wavecore.core.namespace_base import NamespaceObjectBase


class SystemObject(NamespaceObjectBase):
    """Immutable system namespace with dot-access to variables.

    Used during expression evaluation to provide ``system.var_name`` access
    to system-level variables.
    """

    __slots__ = ("_data",)

    _data: dict[str, object]

    def __init__(
        self,
        data: dict[str, object],
    ) -> None:
        object.__setattr__(self, "_data", dict(data))

    def __getattr__(self, name: str) -> object:
        try:
            return self._data[name]
        except KeyError:
            raise AttributeError(f"System namespace has no variable '{name}'") from None

    def __setattr__(self, name: str, value: object) -> None:
        raise AttributeError("SystemObject is immutable")

    def __delattr__(self, name: str) -> None:
        raise AttributeError("SystemObject is immutable")

    def _str_header(self) -> str:
        return "System Variables"
