"""The plugin metadata model's category contract (REQ-6.2.1).

The category a plugin declares is a closed set: the palette, the storage layout
and the MCP block catalog all read it. Helm is a category of its own beside
Kubernetes, and 'orchestration' is not one of them.

The parameter model's declared numeric bounds (REQ-3.4.2.2, PING-17) live here too:
a bound a plugin declares is kept on the way in, and the model never enforces it.

The required-field helpers read a parameter row the same way whether a plugin wrote it as a
plain dictionary or it is a model (REQ-3.4.2.3).
"""

from typing import Any

import pytest
from pydantic import ValidationError

from wavecore.models import plugins as plugin_models
from wavecore.models.controls.parameters import ControlParameter, RequiredWhen
from wavecore.models.plugins import PluginMetadata, PluginParameter
from wavecore.plugins.base import PluginBase
from wavecore.storage.file_storage.storage import PLUGIN_CATEGORIES

CATEGORIES = [
    "network",
    "remote",
    "database",
    "system",
    "kubernetes",
    "helm",
    "data",
    "custom",
]


def _metadata(category: str) -> PluginMetadata:
    return PluginMetadata(name="Helm Install", description="Installs a chart", category=category)


class TestCategoryLiteral:
    """Eight values, no more."""

    @pytest.mark.parametrize("category", CATEGORIES)
    def test_every_declared_category_is_accepted(self, category: str) -> None:
        assert _metadata(category).category == category

    def test_helm_is_a_category_of_its_own(self) -> None:
        assert _metadata("helm").category == "helm"

    def test_orchestration_is_not_a_category(self) -> None:
        with pytest.raises(ValidationError):
            _metadata("orchestration")

    def test_an_invented_category_is_refused(self) -> None:
        with pytest.raises(ValidationError):
            _metadata("charts")


class TestStorageCategories:
    """The storage layer's list is the same set, so a stored plugin round-trips."""

    def test_the_storage_list_holds_the_same_values(self) -> None:
        assert sorted(PLUGIN_CATEGORIES) == sorted(CATEGORIES)

    def test_the_storage_list_carries_helm(self) -> None:
        assert "helm" in PLUGIN_CATEGORIES

    def test_the_storage_list_does_not_carry_orchestration(self) -> None:
        assert "orchestration" not in PLUGIN_CATEGORIES


class TestRemotableFlag:
    """Every Helm block is remotable; the model carries the flag."""

    def test_the_flag_defaults_to_false(self) -> None:
        assert _metadata("helm").remotable is False

    def test_the_flag_can_be_declared(self) -> None:
        metadata = PluginMetadata(
            name="Helm Install",
            description="Installs a chart",
            category="helm",
            remotable=True,
        )

        assert metadata.remotable is True


def _parameter(name: str, param_type: str, **fields: Any) -> PluginParameter:
    """One parameter row; the caller declares only the bounds it cares about."""
    return PluginParameter(name=name, type=param_type, **fields)


class _BoundedPlugin(PluginBase):
    """A plugin whose parameter rows are plain dictionaries, as every shipped plugin writes them."""

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "id": "bounded",
            "name": "Bounded",
            "version": "1.0.0",
            "category": "network",
            "description": "Declares numeric bounds on plain dictionary rows",
            "parameters": [
                {"name": "count", "type": "integer", "default": 4, "minimum": 1, "maximum": 1000},
                {"name": "interval", "type": "float", "default": 1, "minimum": 0.2},
                {"name": "host", "type": "string", "required": True},
            ],
            "return_type": "map",
            "output_schema": [],
        }

    async def execute(self, context: dict[str, Any]) -> Any:
        return None

    async def validate(self, params: dict[str, Any]) -> None:
        return None


class TestParameterNumericBounds:
    """A declared numeric bound survives on the parameter model (REQ-3.4.2.2, PING-17)."""

    @pytest.mark.parametrize(
        ("minimum", "maximum"),
        [(1, None), (None, 1000), (1, 1000)],
    )
    def test_a_declared_bound_reads_back_unchanged(
        self, minimum: float | None, maximum: float | None
    ) -> None:
        parameter = _parameter("count", "integer", minimum=minimum, maximum=maximum)

        assert parameter.minimum == minimum
        assert parameter.maximum == maximum

    def test_a_decimal_bound_survives_on_a_float_row(self) -> None:
        parameter = _parameter("interval", "float", minimum=0.2)

        assert parameter.minimum == 0.2

    def test_a_bound_of_zero_is_declared_not_absent(self) -> None:
        parameter = _parameter("packet_size", "integer", minimum=0)

        assert parameter.minimum == 0
        assert parameter.minimum is not None
        assert parameter.maximum is None

    def test_a_row_declaring_neither_bound_reports_none(self) -> None:
        parameter = _parameter("host", "string")

        assert parameter.minimum is None
        assert parameter.maximum is None

    def test_a_bound_survives_the_plain_dictionary_path(self) -> None:
        count, interval, host = _BoundedPlugin().get_plugin_model().parameters

        assert (count.minimum, count.maximum) == (1, 1000)
        assert (interval.minimum, interval.maximum) == (0.2, None)
        assert (host.minimum, host.maximum) == (None, None)

    def test_the_model_does_not_enforce_the_bound(self) -> None:
        parameter = _parameter("count", "integer", default=5000, minimum=1, maximum=1000)

        assert (parameter.minimum, parameter.maximum) == (1, 1000)
        assert parameter.default == 5000


SHAPES = ["dict", "model"]


def _schema(shape: str, rows: list[dict[str, Any]]) -> list[Any]:
    """Parameter rows as plain dictionaries, as plugins write them, or as models."""
    if shape == "dict":
        return rows
    return [PluginParameter(**{"type": "string", **row}) for row in rows]


def _condition(shape: str, field: str, values: list[str]) -> Any:
    """One required_when condition in the same shape as its schema."""
    if shape == "dict":
        return {"field": field, "values": values}
    return RequiredWhen(field=field, values=values)


class TestParameterAttributeAccessor:
    """``get_param_attr`` reads a dictionary row and a model row the same way."""

    def test_a_dictionary_row_reads_its_key(self) -> None:
        assert plugin_models.get_param_attr({"name": "count", "default": 4}, "default") == 4

    def test_a_dictionary_row_falls_back_when_the_key_is_absent(self) -> None:
        assert plugin_models.get_param_attr({"name": "count"}, "required", False) is False

    def test_a_dictionary_values_key_is_read_not_the_method(self) -> None:
        condition = {"field": "mode", "values": ["count"]}

        assert plugin_models.get_param_attr(condition, "values", []) == ["count"]
        assert plugin_models.get_param_attr({"field": "mode"}, "values", []) == []

    def test_a_model_row_reads_its_field(self) -> None:
        parameter = _parameter("count", "integer", default=4)

        assert plugin_models.get_param_attr(parameter, "default") == 4

    def test_a_model_row_falls_back_for_a_field_it_does_not_have(self) -> None:
        parameter = _parameter("count", "integer")

        assert plugin_models.get_param_attr(parameter, "not_declared", "fallback") == "fallback"

    def test_a_condition_model_reads_its_values(self) -> None:
        condition = RequiredWhen(field="mode", values=["count"])

        assert plugin_models.get_param_attr(condition, "values", []) == ["count"]


class TestConditionallyRequiredHelper:
    """``is_conditionally_required`` reads the referenced field, or its declared default
    (REQ-3.4.2.3)."""

    @pytest.mark.parametrize("shape", SHAPES)
    def test_an_unset_field_falls_back_to_the_referenced_parameter_default(
        self, shape: str
    ) -> None:
        schema = _schema(
            shape,
            [
                {"name": "mode", "default": "count"},
                {"name": "count", "required_when": {"field": "mode", "values": ["count"]}},
            ],
        )

        required = plugin_models.is_conditionally_required(
            _condition(shape, "mode", ["count"]), {}, schema
        )

        assert required is True

    @pytest.mark.parametrize("shape", SHAPES)
    def test_an_unset_field_with_no_declared_parameter_is_not_required(self, shape: str) -> None:
        required = plugin_models.is_conditionally_required(
            _condition(shape, "mode", ["count"]), {}, []
        )

        assert required is False

    @pytest.mark.parametrize("shape", SHAPES)
    def test_an_explicit_value_wins_over_the_declared_default(self, shape: str) -> None:
        schema = _schema(shape, [{"name": "mode", "default": "count"}])

        required = plugin_models.is_conditionally_required(
            _condition(shape, "mode", ["count"]), {"mode": "range"}, schema
        )

        assert required is False

    @pytest.mark.parametrize("shape", SHAPES)
    def test_a_boolean_field_compares_against_the_lowercase_convention(self, shape: str) -> None:
        schema = _schema(shape, [{"name": "scoped", "type": "boolean", "default": False}])

        assert (
            plugin_models.is_conditionally_required(
                _condition(shape, "scoped", ["true"]), {"scoped": True}, schema
            )
            is True
        )
        assert (
            plugin_models.is_conditionally_required(
                _condition(shape, "scoped", ["false"]), {"scoped": False}, schema
            )
            is True
        )

    @pytest.mark.parametrize("shape", SHAPES)
    def test_a_boolean_default_is_read_the_same_way(self, shape: str) -> None:
        schema = _schema(shape, [{"name": "scoped", "type": "boolean", "default": False}])

        required = plugin_models.is_conditionally_required(
            _condition(shape, "scoped", ["true"]), {}, schema
        )

        assert required is False


CONJUNCTION_ROWS: list[dict[str, Any]] = [
    {"name": "scoped", "type": "boolean", "default": False},
    {"name": "object_type", "default": "default"},
    {
        "name": "object_kind",
        "required_when_all": [
            {"field": "scoped", "values": ["true"]},
            {"field": "object_type", "values": ["default"]},
        ],
    },
]


class TestParamRequiredHelper:
    """``is_param_required`` covers required, required_when and required_when_all on dictionary
    and model rows alike (REQ-3.4.2.3)."""

    @pytest.mark.parametrize("shape", SHAPES)
    @pytest.mark.parametrize(
        ("values", "expected"),
        [
            pytest.param({"scoped": True, "object_type": "default"}, True, id="every-match"),
            pytest.param({"scoped": True, "object_type": "custom"}, False, id="one-fails"),
            pytest.param({}, False, id="defaults-only"),
        ],
    )
    def test_required_when_all_needs_every_condition(
        self, shape: str, values: dict[str, Any], expected: bool
    ) -> None:
        schema = _schema(shape, CONJUNCTION_ROWS)
        object_kind = schema[2]

        assert plugin_models.is_param_required(object_kind, values, schema) is expected

    @pytest.mark.parametrize("shape", SHAPES)
    @pytest.mark.parametrize(
        ("values", "expected"),
        [
            pytest.param({}, True, id="default-matches"),
            pytest.param({"mode": "range"}, False, id="set-elsewhere"),
        ],
    )
    def test_required_when_reads_the_condition(
        self, shape: str, values: dict[str, Any], expected: bool
    ) -> None:
        schema = _schema(
            shape,
            [
                {"name": "mode", "default": "count"},
                {"name": "count", "required_when": {"field": "mode", "values": ["count"]}},
            ],
        )

        assert plugin_models.is_param_required(schema[1], values, schema) is expected

    @pytest.mark.parametrize("shape", SHAPES)
    def test_an_unconditionally_required_parameter_needs_no_conditions(self, shape: str) -> None:
        (session,) = _schema(shape, [{"name": "session", "required": True}])

        assert plugin_models.is_param_required(session, {}, []) is True

    @pytest.mark.parametrize("shape", SHAPES)
    def test_a_parameter_with_neither_form_is_optional(self, shape: str) -> None:
        (reason,) = _schema(shape, [{"name": "reason"}])

        assert plugin_models.is_param_required(reason, {}, []) is False

    @pytest.mark.parametrize("shape", SHAPES)
    def test_an_empty_conjunction_leaves_the_parameter_optional(self, shape: str) -> None:
        (object_kind,) = _schema(shape, [{"name": "object_kind", "required_when_all": []}])

        assert plugin_models.is_param_required(object_kind, {}, []) is False

    def test_a_control_parameter_model_is_read_the_same_way(self) -> None:
        schema = [
            ControlParameter(name="mode", type="string", default="count"),
            ControlParameter(
                name="count",
                type="integer",
                required_when=RequiredWhen(field="mode", values=["count"]),
            ),
            ControlParameter(name="variables", type="map", required=True),
        ]

        assert plugin_models.is_param_required(schema[1], {}, schema) is True
        assert plugin_models.is_param_required(schema[1], {"mode": "range"}, schema) is False
        assert plugin_models.is_param_required(schema[2], {}, schema) is True
