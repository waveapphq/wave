"""Unit tests for NamespaceObjectBase shared protocol methods."""

from wavecore.core.namespace_base import NamespaceObjectBase


class ConcreteNamespace(NamespaceObjectBase):
    """Concrete test subclass."""

    __slots__ = ("_data",)

    def __init__(self, data: dict[str, object]) -> None:
        object.__setattr__(self, "_data", dict(data))

    def __getattr__(self, name: str) -> object:
        try:
            return self._data[name]
        except KeyError:
            raise AttributeError(f"no '{name}'") from None

    def __setattr__(self, name: str, value: object) -> None:
        raise AttributeError("immutable")

    def __delattr__(self, name: str) -> None:
        raise AttributeError("immutable")


class TestNamespaceObjectBaseProtocol:
    """Container protocol inherited by all namespace objects."""

    def test_get_values_returns_dict_copy(self) -> None:
        obj = ConcreteNamespace({"a": 1, "b": 2})
        values = obj.get_values()
        assert values == {"a": 1, "b": 2}
        values["a"] = 999
        assert obj.a == 1

    def test_get_params_returns_keys(self) -> None:
        obj = ConcreteNamespace({"x": 10, "y": 20})
        assert set(obj.get_params()) == {"x", "y"}

    def test_contains_existing(self) -> None:
        obj = ConcreteNamespace({"a": 1})
        assert "a" in obj

    def test_contains_missing(self) -> None:
        obj = ConcreteNamespace({"a": 1})
        assert "b" not in obj

    def test_len(self) -> None:
        obj = ConcreteNamespace({"a": 1, "b": 2})
        assert len(obj) == 2

    def test_eq_same_type_same_data(self) -> None:
        a = ConcreteNamespace({"x": 1})
        b = ConcreteNamespace({"x": 1})
        assert a == b

    def test_eq_different_type(self) -> None:
        obj = ConcreteNamespace({"x": 1})
        assert obj.__eq__({"x": 1}) is NotImplemented

    def test_bool_always_true(self) -> None:
        assert bool(ConcreteNamespace({})) is True
        assert bool(ConcreteNamespace({"x": 1})) is True

    def test_str_default_header(self) -> None:
        obj = ConcreteNamespace({"key": "val"})
        result = str(obj)
        assert "Namespace" in result
        assert "key" in result
        assert "val" in result

    def test_str_empty_shows_marker(self) -> None:
        obj = ConcreteNamespace({})
        assert "(empty)" in str(obj)

    def test_repr_matches_str(self) -> None:
        obj = ConcreteNamespace({"a": 1})
        assert repr(obj) == str(obj)
