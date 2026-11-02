"""Immutable regression object with attribute access for expression evaluation.

Injected into the variable context at ``variables["regression"]`` so that
``eval("regression.field")`` resolves via ``__getattr__``.
"""

from wavecore.core.namespace_base import NamespaceObjectBase


class RegressionObject(NamespaceObjectBase):
    """Immutable regression namespace with dot-access to variables.

    Used during regression execution to provide ``regression.var_name`` access
    in expression evaluation.
    """

    __slots__ = ("_data", "_regression_name")

    _data: dict[str, object]
    _regression_name: str

    def __init__(
        self,
        data: dict[str, object],
        regression_name: str = "",
    ) -> None:
        object.__setattr__(self, "_data", dict(data))
        object.__setattr__(self, "_regression_name", regression_name)

    def __getattr__(self, name: str) -> object:
        try:
            return self._data[name]
        except KeyError:
            raise AttributeError(
                f"Regression '{self._regression_name}' has no variable '{name}'"
            ) from None

    def __setattr__(self, name: str, value: object) -> None:
        raise AttributeError("RegressionObject is immutable")

    def __delattr__(self, name: str) -> None:
        raise AttributeError("RegressionObject is immutable")

    def _str_header(self) -> str:
        return f"Regression: {self._regression_name}"
