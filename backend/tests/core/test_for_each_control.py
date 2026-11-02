"""Tests for ForEachControl.

Covers metadata declaration, parameter validation, and execution signals.

REQ-3.5.1.16: For-Each loop with typed envelope iteration
"""

import asyncio

import pytest

from wavecore.controls.loop import ForEachControl, resolve_collection
from wavecore.core.table import Table
from wavecore.models.controls.parameters import ControlParameter
from wavecore.models.enums import ControlId


def _hosts_table() -> Table:
    """A two-column table, as a plugin read from a workbook or CSV would return."""
    table = Table(columns=[("host", "string"), ("port", "integer")])
    table.add_row(["10.0.0.1", 22])
    table.add_row(["10.0.0.2", 8080])
    return table


class TestForEachControlMetadata:
    """Verify ForEachControl metadata declaration matches design spec."""

    def setup_method(self) -> None:
        self.control = ForEachControl()
        self.meta = self.control.metadata

    def test_control_id(self) -> None:
        assert self.meta["id"] == ControlId.FOR_EACH

    def test_control_version(self) -> None:
        assert self.meta["version"] == "1.0.0"

    def test_control_name(self) -> None:
        assert self.meta["name"] == "For Each"

    def test_control_category(self) -> None:
        assert self.meta["category"] == "loop"

    def test_control_icon(self) -> None:
        assert self.meta["icon_name"] == "list"

    def test_control_description(self) -> None:
        assert isinstance(self.meta["description"], str)
        assert len(self.meta["description"]) > 0

    def _param(self, name: str) -> ControlParameter:
        return next(p for p in self.meta["parameter_schema"] if p.name == name)

    def test_parameter_schema_count(self) -> None:
        """ForEach has 3 parameters: collection, collection_type, timeout."""
        assert len(self.meta["parameter_schema"]) == 3
        assert {p.name for p in self.meta["parameter_schema"]} == {
            "collection",
            "collection_type",
            "timeout",
        }

    def test_parameter_collection(self) -> None:
        """collection param: type=[array, map, table], required=True."""
        param = self.meta["parameter_schema"][0]
        assert isinstance(param, ControlParameter)
        assert param.name == "collection"
        assert param.type == ["array", "map", "table"]
        assert param.required is True

    def test_parameter_collection_type(self) -> None:
        """collection_type: the type the window's type picker writes (array, map or table)."""
        param = self._param("collection_type")
        assert isinstance(param, ControlParameter)
        assert param.type == "string"
        assert param.required is False
        assert param.enum_values == ["array", "map", "table"]
        assert param.default is None

    def test_parameter_timeout(self) -> None:
        """timeout param: type=float, required=False, no default."""
        param = self._param("timeout")
        assert isinstance(param, ControlParameter)
        assert param.name == "timeout"
        assert param.type == "float"
        assert param.required is False
        assert param.default is None

    def test_output_schema_count(self) -> None:
        """ForEach has 2 outputs: item and index."""
        assert len(self.meta["output_schema"]) == 2

    def test_output_item(self) -> None:
        """item output: type=map (typed envelope)."""
        output = self.meta["output_schema"][0]
        assert output["name"] == "item"
        assert output["type"] == "map"

    def test_output_index(self) -> None:
        """index output: type=integer."""
        output = self.meta["output_schema"][1]
        assert output["name"] == "index"
        assert output["type"] == "integer"

    def test_structure_hints_type(self) -> None:
        assert self.meta["structure_hints"]["type"] == "looping"

    def test_structure_hints_has_body(self) -> None:
        assert self.meta["structure_hints"]["has_body"] is True

    def test_structure_hints_branches(self) -> None:
        assert self.meta["structure_hints"]["branches"] == ["body", "then"]

    def test_structure_hints_egress(self) -> None:
        assert self.meta["structure_hints"]["egress"] == "then"

    def test_no_variable_parameter(self) -> None:
        """For Each takes no variable or index_variable input parameter."""
        param_names = [p.name for p in self.meta["parameter_schema"]]
        assert "variable" not in param_names
        assert "index_variable" not in param_names

    def test_the_collection_takes_null(self) -> None:
        """A null collection runs zero times (REQ-3.1.3.25): the setting declares it takes null."""
        param = self.meta["parameter_schema"][0]
        assert (param.name, param.accepts_null) == ("collection", True)


class TestForEachControlValidation:
    """Test parameter validation for ForEachControl."""

    def setup_method(self) -> None:
        self.control = ForEachControl()

    def test_validate_missing_collection(self) -> None:
        """Missing collection raises ValueError with exact message."""
        with pytest.raises(ValueError, match="^collection parameter is required$"):
            asyncio.run(self.control.validate({}))

    def test_validate_collection_not_iterable(self) -> None:
        """Non-iterable collection raises ValueError with exact message."""
        with pytest.raises(ValueError, match="^collection must be a list, dict, or table$"):
            asyncio.run(self.control.validate({"collection": 42}))

    def test_validate_collection_string_not_iterable(self) -> None:
        """String collection is not considered iterable for ForEach purposes."""
        with pytest.raises(ValueError, match="^collection must be a list, dict, or table$"):
            asyncio.run(self.control.validate({"collection": "not-a-collection"}))

    def test_validate_collection_bool_not_iterable(self) -> None:
        """Boolean collection is not iterable."""
        with pytest.raises(ValueError, match="^collection must be a list, dict, or table$"):
            asyncio.run(self.control.validate({"collection": True}))

    def test_validate_valid_list(self) -> None:
        """Valid list collection passes validation."""
        asyncio.run(self.control.validate({"collection": ["a", "b", "c"]}))

    def test_validate_valid_dict(self) -> None:
        """Valid dict collection passes validation."""
        asyncio.run(self.control.validate({"collection": {"host": "10.0.0.1"}}))

    def test_validate_empty_list(self) -> None:
        """Empty list passes validation - 0 iterations is valid."""
        asyncio.run(self.control.validate({"collection": []}))

    def test_validate_empty_dict(self) -> None:
        """Empty dict passes validation - 0 iterations is valid."""
        asyncio.run(self.control.validate({"collection": {}}))

    def test_validate_accepts_a_null_collection(self) -> None:
        """A null collection runs zero times (REQ-3.1.3.25)."""
        assert asyncio.run(self.control.validate({"collection": None})) is None

    def test_validate_accepts_list(self) -> None:
        """List collection passes validation."""
        asyncio.run(self.control.validate({"collection": [1, 2]}))

    def test_validate_accepts_dict(self) -> None:
        """Dict collection passes validation."""
        asyncio.run(self.control.validate({"collection": {"a": 1}}))

    def test_validate_accepts_table(self) -> None:
        """A plugin-produced Table is the third declared collection type."""
        asyncio.run(self.control.validate({"collection": _hosts_table()}))

    def test_validate_accepts_empty_table(self) -> None:
        """Empty table passes validation - 0 iterations is valid."""
        asyncio.run(self.control.validate({"collection": Table(columns=[("host", "string")])}))

    def test_validate_accepts_table_with_no_columns(self) -> None:
        asyncio.run(self.control.validate({"collection": Table()}))

    def test_validate_tuple_not_iterable(self) -> None:
        """A tuple is not one of the three declared collection types."""
        with pytest.raises(ValueError, match="^collection must be a list, dict, or table$"):
            asyncio.run(self.control.validate({"collection": (1, 2, 3)}))

    def test_validate_float_not_iterable(self) -> None:
        with pytest.raises(ValueError, match="^collection must be a list, dict, or table$"):
            asyncio.run(self.control.validate({"collection": 1.5}))


class TestForEachControlExecution:
    """Test execute() return signals for ForEachControl."""

    def setup_method(self) -> None:
        self.control = ForEachControl()

    def test_execute_array_of_strings(self) -> None:
        """Array collection returns __for_each signal with typed envelope for first item."""
        context: dict = {
            "parameters": {"collection": ["host-a", "host-b", "host-c"]},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__for_each"] is True
        assert result["__collection"] == ["host-a", "host-b", "host-c"]
        assert result["__item_variable"] == "item"
        assert result["__index_variable"] == "index"
        assert result["item"] == {"type": "string", "value": "host-a"}
        assert result["index"] == 0

    def test_the_stored_collection_type_never_steers_the_run(self) -> None:
        """The collection's own shape drives the loop; collection_type is the row's stored type."""
        context: dict = {
            "parameters": {"collection": ["host-a", "host-b"], "collection_type": "map"},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__collection"] == ["host-a", "host-b"]
        assert result["item"] == {"type": "string", "value": "host-a"}
        assert result["index"] == 0

    def test_execute_array_of_integers(self) -> None:
        """Array of ints returns integer-typed envelope."""
        context: dict = {
            "parameters": {"collection": [1, 2, 3]},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__for_each"] is True
        assert result["item"] == {"type": "integer", "value": 1}
        assert result["index"] == 0

    def test_execute_array_of_floats(self) -> None:
        """Array of floats returns float-typed envelope."""
        context: dict = {
            "parameters": {"collection": [1.5, 2.5]},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["item"] == {"type": "float", "value": 1.5}

    def test_execute_array_of_booleans(self) -> None:
        """Array of booleans returns boolean-typed envelope."""
        context: dict = {
            "parameters": {"collection": [True, False]},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["item"] == {"type": "boolean", "value": True}

    def test_execute_array_of_dicts(self) -> None:
        """Array of dicts (table rows) returns map-typed envelope."""
        context: dict = {
            "parameters": {"collection": [{"name": "a"}, {"name": "b"}]},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["item"] == {"type": "map", "value": {"name": "a"}}
        assert result["index"] == 0

    def test_execute_array_of_lists(self) -> None:
        """Array of lists returns array-typed envelope."""
        context: dict = {
            "parameters": {"collection": [[1, 2], [3, 4]]},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["item"] == {"type": "array", "value": [1, 2]}

    def test_execute_map_collection(self) -> None:
        """Map collection iterates over root-level keys."""
        context: dict = {
            "parameters": {"collection": {"host": "10.0.0.1", "port": 8080}},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__for_each"] is True
        # Dict keys become the collection
        assert result["__collection"] == list({"host": "10.0.0.1", "port": 8080}.keys())
        assert result["__item_variable"] == "item"
        assert result["__index_variable"] == "index"
        assert result["item"] == {"type": "string", "value": "host"}
        assert result["index"] == 0

    def test_execute_empty_array(self) -> None:
        """Empty array returns empty envelope with index 0."""
        context: dict = {
            "parameters": {"collection": []},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__for_each"] is True
        assert result["__collection"] == []
        assert result["item"] == {}
        assert result["index"] == 0

    def test_execute_null_collection_runs_zero_times(self) -> None:
        context: dict = {"parameters": {"collection": None}, "variables": {}}

        result = asyncio.run(self.control.execute(context))

        assert result["__for_each"] is True
        assert (result["__collection"], result["item"], result["index"]) == ([], {}, 0)

    def test_execute_empty_dict(self) -> None:
        """Empty dict returns empty envelope with index 0."""
        context: dict = {
            "parameters": {"collection": {}},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__for_each"] is True
        assert result["__collection"] == []
        assert result["item"] == {}
        assert result["index"] == 0

    def test_execute_single_element_array(self) -> None:
        """Single element array - first item envelope is the only item."""
        context: dict = {
            "parameters": {"collection": ["only-one"]},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["item"] == {"type": "string", "value": "only-one"}
        assert result["index"] == 0

    def test_execute_mixed_type_array(self) -> None:
        """Mixed type array - first item type determines the envelope type."""
        context: dict = {
            "parameters": {"collection": [42, "text", True]},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["item"] == {"type": "integer", "value": 42}

    def test_execute_custom_object_wraps_as_string(self) -> None:
        """Custom (non-standard) object in collection wraps as string fallback."""

        class Custom:
            def __str__(self) -> str:
                return "custom-obj"

        context: dict = {
            "parameters": {"collection": [Custom()]},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["item"] == {"type": "string", "value": "custom-obj"}

    def test_execute_returns_all_required_signal_keys(self) -> None:
        """Verify all required engine signal keys are present in result."""
        context: dict = {
            "parameters": {"collection": ["a"]},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        required_keys = {
            "__for_each",
            "__collection",
            "__item_variable",
            "__index_variable",
            "item",
            "index",
        }
        assert required_keys.issubset(set(result.keys()))

    def test_execute_item_variable_is_item(self) -> None:
        """__item_variable is always 'item' (naming via output bindings, not params)."""
        context: dict = {
            "parameters": {"collection": ["a"]},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__item_variable"] == "item"

    def test_execute_index_variable_is_index(self) -> None:
        """__index_variable is always 'index' (naming via output bindings, not params)."""
        context: dict = {
            "parameters": {"collection": ["a"]},
            "variables": {},
        }
        result = asyncio.run(self.control.execute(context))
        assert result["__index_variable"] == "index"


class TestForEachControlTableExecution:
    """Execution over a Table: one iteration per row, each row a map of columns."""

    def setup_method(self) -> None:
        self.control = ForEachControl()

    def test_execute_table_yields_one_item_per_row(self) -> None:
        context: dict = {"parameters": {"collection": _hosts_table()}, "variables": {}}

        result = asyncio.run(self.control.execute(context))

        assert result["__for_each"] is True
        assert result["__collection"] == [
            {"host": "10.0.0.1", "port": 22},
            {"host": "10.0.0.2", "port": 8080},
        ]

    def test_execute_table_first_item_is_a_map_envelope(self) -> None:
        """A row reads as item.value.<column>, so the envelope type is map."""
        context: dict = {"parameters": {"collection": _hosts_table()}, "variables": {}}

        result = asyncio.run(self.control.execute(context))

        assert result["item"] == {"type": "map", "value": {"host": "10.0.0.1", "port": 22}}
        assert result["index"] == 0

    def test_execute_single_column_table(self) -> None:
        table = Table(columns=[("host", "string")])
        table.add_row(["10.0.0.1"])
        context: dict = {"parameters": {"collection": table}, "variables": {}}

        result = asyncio.run(self.control.execute(context))

        assert result["__collection"] == [{"host": "10.0.0.1"}]
        assert result["item"] == {"type": "map", "value": {"host": "10.0.0.1"}}

    def test_execute_single_row_table(self) -> None:
        table = Table(columns=[("host", "string"), ("port", "integer")])
        table.add_row(["10.0.0.9", 443])
        context: dict = {"parameters": {"collection": table}, "variables": {}}

        result = asyncio.run(self.control.execute(context))

        assert result["__collection"] == [{"host": "10.0.0.9", "port": 443}]

    def test_execute_table_preserves_none_cells(self) -> None:
        """An empty spreadsheet cell stays missing in the row map."""
        table = Table(columns=[("host", "string"), ("port", "integer")])
        table.add_row(["10.0.0.1", None])
        context: dict = {"parameters": {"collection": table}, "variables": {}}

        result = asyncio.run(self.control.execute(context))

        assert result["__collection"] == [{"host": "10.0.0.1", "port": None}]

    def test_execute_empty_table_yields_no_iterations(self) -> None:
        context: dict = {
            "parameters": {"collection": Table(columns=[("host", "string")])},
            "variables": {},
        }

        result = asyncio.run(self.control.execute(context))

        assert result["__for_each"] is True
        assert result["__collection"] == []
        assert result["item"] == {}
        assert result["index"] == 0

    def test_execute_table_row_order_is_preserved(self) -> None:
        table = Table(columns=[("n", "integer")])
        for n in (3, 1, 2):
            table.add_row([n])
        context: dict = {"parameters": {"collection": table}, "variables": {}}

        result = asyncio.run(self.control.execute(context))

        assert result["__collection"] == [{"n": 3}, {"n": 1}, {"n": 2}]


class TestResolveCollection:
    """The single collection resolver both execution paths use.

    Moved here from the workbench's private copy: the rule lives once, so the
    control path and the workbench path cannot drift on what a collection is.
    """

    def test_resolve_list_passthrough(self) -> None:
        assert resolve_collection(["a", "b", "c"]) == ["a", "b", "c"]

    def test_resolve_list_preserves_order(self) -> None:
        assert resolve_collection([3, 1, 2]) == [3, 1, 2]

    def test_resolve_dict_returns_keys(self) -> None:
        assert resolve_collection({"host": "10.0.0.1", "port": 8080}) == ["host", "port"]

    def test_resolve_empty_list(self) -> None:
        assert resolve_collection([]) == []

    def test_resolve_empty_dict(self) -> None:
        assert resolve_collection({}) == []

    def test_resolve_table_returns_row_maps(self) -> None:
        assert resolve_collection(_hosts_table()) == [
            {"host": "10.0.0.1", "port": 22},
            {"host": "10.0.0.2", "port": 8080},
        ]

    def test_resolve_empty_table(self) -> None:
        assert resolve_collection(Table(columns=[("host", "string")])) == []

    def test_resolve_table_with_no_columns(self) -> None:
        assert resolve_collection(Table()) == []

    def test_resolve_list_of_row_maps_stays_a_list_of_items(self) -> None:
        """A stored array of maps iterates as its elements, not as table rows."""
        rows = [{"host": "10.0.0.1"}, {"host": "10.0.0.2"}]

        assert resolve_collection(rows) == rows

    def test_resolve_integer_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="^collection must be a list, dict, or table$"):
            resolve_collection(42)

    def test_resolve_string_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="^collection must be a list, dict, or table$"):
            resolve_collection("not-a-collection")

    def test_resolve_none_is_no_items(self) -> None:
        assert resolve_collection(None) == []

    def test_resolve_boolean_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="^collection must be a list, dict, or table$"):
            resolve_collection(True)

    def test_resolve_tuple_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="^collection must be a list, dict, or table$"):
            resolve_collection((1, 2, 3))

    def test_resolve_float_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="^collection must be a list, dict, or table$"):
            resolve_collection(1.5)
