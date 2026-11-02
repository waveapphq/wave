"""Immutable suite object with attribute access for expression evaluation.

Injected into the variable context at ``variables["suite"]`` so that
``eval("suite.field")`` resolves via ``__getattr__``.
"""

from wavecore.core.namespace_base import NamespaceObjectBase


class SuiteObject(NamespaceObjectBase):
    """Immutable suite namespace with dot-access to variables.

    Used during suite execution to provide ``suite.var_name`` access
    in expression evaluation.
    """

    __slots__ = ("_data", "_suite_name")

    _data: dict[str, object]
    _suite_name: str

    def __init__(
        self,
        data: dict[str, object],
        suite_name: str = "",
    ) -> None:
        object.__setattr__(self, "_data", dict(data))
        object.__setattr__(self, "_suite_name", suite_name)

    def __getattr__(self, name: str) -> object:
        try:
            return self._data[name]
        except KeyError:
            raise AttributeError(f"Suite '{self._suite_name}' has no variable '{name}'") from None

    def __setattr__(self, name: str, value: object) -> None:
        raise AttributeError("SuiteObject is immutable")

    def __delattr__(self, name: str) -> None:
        raise AttributeError("SuiteObject is immutable")

    def _str_header(self) -> str:
        return f"Suite: {self._suite_name}"
