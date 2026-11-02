"""Immutable profile object with attribute access for expression evaluation.

Injected into the variable context at ``variables[alias]`` so that
``eval("alias.field")`` resolves via ``__getattr__``.
"""

from wavecore.core.namespace_base import NamespaceObjectBase


class ProfileObject(NamespaceObjectBase):
    """Immutable profile with dot-access to fields.

    Used by ``_inject_profile_variables()`` to replace plain dicts,
    enabling ``eval("alias.field")`` in expression evaluation.
    """

    __slots__ = ("_data", "_alias", "_profile_name", "_profile_type")

    _data: dict[str, object]
    _alias: str
    _profile_name: str
    _profile_type: str

    def __init__(
        self,
        data: dict[str, object],
        alias: str = "",
        profile_name: str = "",
        profile_type: str = "",
    ) -> None:
        object.__setattr__(self, "_data", dict(data))
        object.__setattr__(self, "_alias", alias)
        object.__setattr__(self, "_profile_name", profile_name)
        object.__setattr__(self, "_profile_type", profile_type)

    def __getattr__(self, name: str) -> object:
        try:
            return self._data[name]
        except KeyError:
            raise AttributeError(f"Profile '{self._alias}' has no field '{name}'") from None

    def __setattr__(self, name: str, value: object) -> None:
        raise AttributeError("ProfileObject is immutable")

    def __delattr__(self, name: str) -> None:
        raise AttributeError("ProfileObject is immutable")

    def _str_header(self) -> str:
        header = f"Profile: {self._profile_name or self._alias}"
        if self._profile_type:
            header += f" ({self._profile_type})"
        return header
