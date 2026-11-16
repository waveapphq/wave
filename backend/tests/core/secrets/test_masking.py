"""
Masking function contract tests (REQ-3.1.3.5, REQ-4.5.3).

Two masking mechanisms share one canonical placeholder:
- mask_text: value-scrub of registered secret byte-forms inside outbound text
- mask_structure / structural_mask: flag-based full-opacity masking of
  variable displays (a secret shows as the bare placeholder - no keys,
  no shape, no counts)

There is no reveal, config or filter surface.
"""

import sys
from collections.abc import Callable
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import pytest

import wavecore.core.secrets.masking as masking_module
import wavecore.core.secrets.registry as registry_module
from wavecore.core.secrets.masking import (
    MASK_PLACEHOLDER,
    mask_structure,
    mask_text,
    mask_with_metadata,
    structural_mask,
)
from wavecore.core.secrets.registry import MAX_DEPTH, SecretRegistry
from wavecore.core.table import Table
from wavecore.core.variables.wire_form import wire_values


class TestMaskPlaceholder:
    def test_placeholder_is_exactly_eight_asterisks(self) -> None:
        assert MASK_PLACEHOLDER == "********"


class TestMaskText:
    """Value-scrub of outbound text."""

    def test_replaces_a_whole_message_occurrence(self) -> None:
        assert mask_text("s3cr3t-t0ken-99", ("s3cr3t-t0ken-99",)) == "********"

    def test_replaces_mid_string_composed_occurrence(self) -> None:
        result = mask_text("Authorization: Bearer s3cr3t-t0ken-99", ("s3cr3t-t0ken-99",))

        assert result == "Authorization: Bearer ********"

    def test_replaces_every_occurrence(self) -> None:
        result = mask_text(
            "first s3cr3t-t0ken-99 then s3cr3t-t0ken-99 again",
            ("s3cr3t-t0ken-99",),
        )

        assert result == "first ******** then ******** again"

    def test_replaces_multiple_registered_values(self) -> None:
        result = mask_text(
            "user hunter2secret token s3cr3t-t0ken-99",
            ("s3cr3t-t0ken-99", "hunter2secret"),
        )

        assert result == "user ******** token ********"

    def test_longest_first_order_prevents_partial_double_mask(self) -> None:
        registry = SecretRegistry()
        registry.register("token", "abcdef", "declared")
        registry.register("long_token", "abcdef123456", "declared")

        result = mask_text("value=abcdef123456;other=abcdef", registry.scan_values())

        assert result == "value=********;other=********"

    def test_a_registry_scan_is_used_in_its_order_without_sorting_it_again(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        registry = SecretRegistry()
        registry.register("token", "abcdef", "declared")
        registry.register("long_token", "abcdef123456", "declared")
        scan = registry.scan_values()
        sorts: list[Any] = []

        def counted(*args: Any, **kwargs: Any) -> Any:
            sorts.append(args)
            return sorted(*args, **kwargs)

        monkeypatch.setattr(masking_module, "sorted", counted, raising=False)

        assert mask_text("value=abcdef123456;other=abcdef", scan) == "value=********;other=********"
        assert sorts == []
        assert mask_text("value=abcdef123456", ("abcdef", "abcdef123456")) == "value=********"
        assert len(sorts) == 1

    @pytest.mark.parametrize("name", ["mask_values", "mask_wire_values"])
    def test_a_value_pass_given_plain_forms_replaces_the_longest_first(self, name: str) -> None:
        masked = getattr(masking_module, name)({"v": "id abcdef123456"}, ("abcdef", "abcdef123456"))

        assert masked == {"v": "id ********"}

    def test_no_scan_values_leaves_text_unchanged(self) -> None:
        assert mask_text("nothing to hide", ()) == "nothing to hide"

    def test_text_without_occurrences_is_unchanged(self) -> None:
        assert mask_text("plain message", ("s3cr3t-t0ken-99",)) == "plain message"

    def test_short_scalar_secret_is_text_masked(self) -> None:
        registry = SecretRegistry()
        registry.register("pin", "123", "declared")

        assert mask_text("code 123 accepted", registry.scan_values()) == "code ******** accepted"

    def test_whole_map_print_masks_to_a_single_placeholder(self) -> None:
        creds = {"user": "u", "pass": "hunter2secret"}
        registry = SecretRegistry()
        registry.register("creds", creds, "declared")

        result = mask_text(f"data: {creds}", registry.scan_values())

        assert result == "data: ********"

    def test_whole_array_print_masks_to_a_single_placeholder(self) -> None:
        tokens = ["t0ken-first-1", "t0ken-second-2"]
        registry = SecretRegistry()
        registry.register("tokens", tokens, "declared")

        result = mask_text(f"tokens={tokens}", registry.scan_values())

        assert result == "tokens=********"

    def test_nested_sub_container_print_masks_to_a_single_placeholder(self) -> None:
        creds = [{"password": "nested-s3cr3t-1"}]
        registry = SecretRegistry()
        registry.register("creds", creds, "declared")

        result = mask_text(f"first: {creds[0]}", registry.scan_values())

        assert result == "first: ********"


class TestStructuralMask:
    """Full-opacity mask of one value: bare placeholder, never keys or shape."""

    def test_string_scalar_masks_to_placeholder(self) -> None:
        assert structural_mask("s3cr3t") == "********"

    def test_integer_scalar_masks_to_placeholder(self) -> None:
        assert structural_mask(1234567) == "********"

    def test_boolean_masks_to_placeholder(self) -> None:
        assert structural_mask(True) == "********"

    @pytest.mark.parametrize("value", [None, ""])
    def test_a_value_holding_nothing_is_left_as_it_is(self, value: Any) -> None:
        assert structural_mask(value) is value

    def test_list_masks_to_bare_placeholder(self) -> None:
        assert structural_mask(["a", "b", "c"]) == "********"

    def test_dict_masks_to_bare_placeholder_without_keys(self) -> None:
        assert structural_mask({"user": "u", "pass": "p"}) == "********"

    def test_nested_structure_masks_to_bare_placeholder(self) -> None:
        assert structural_mask({"outer": [{"inner": "value"}, "leaf"]}) == "********"


class TestMaskWithMetadata:
    """Structure/length metadata without value or key exposure."""

    def test_string_metadata_includes_length(self) -> None:
        result = mask_with_metadata("s3cr3t-t0ken-99")

        assert result["value"] == "********"
        assert result["metadata"] == {"length": 15}

    def test_array_metadata_includes_type_and_size(self) -> None:
        result = mask_with_metadata(["a", "b", "c"])

        assert result["metadata"] == {"type": "array", "size": 3}
        assert result["value"] == "********"

    def test_map_metadata_excludes_keys(self) -> None:
        result = mask_with_metadata({"user": "u", "pass": "p"})

        assert result["metadata"] == {"type": "map", "size": 2}
        assert result["value"] == "********"

    def test_scalar_non_string_metadata_is_empty(self) -> None:
        result = mask_with_metadata(1234567)

        assert result["value"] == "********"
        assert result["metadata"] == {}


class TestMaskStructure:
    """Structured payload masking of variables-shaped mappings."""

    def _registry(self) -> SecretRegistry:
        registry = SecretRegistry()
        registry.register("token", "s3cr3t-t0ken-99", "declared")
        return registry

    def test_flagged_name_masks_structurally(self) -> None:
        registry = self._registry()

        masked = mask_structure({"token": "s3cr3t-t0ken-99"}, registry)

        assert masked == {"token": "********"}

    def test_flagged_container_collapses_to_bare_placeholder(self) -> None:
        registry = SecretRegistry()
        registry.register("creds", {"user": "u", "pass": "p"}, "declared")

        masked = mask_structure({"creds": {"user": "u", "pass": "p"}}, registry)

        assert masked == {"creds": "********"}

    def test_verbatim_copy_in_unflagged_string_is_scrubbed(self) -> None:
        registry = self._registry()

        masked = mask_structure({"copied": "Bearer s3cr3t-t0ken-99"}, registry)

        assert masked == {"copied": "Bearer ********"}

    def test_verbatim_copy_inside_unflagged_container_is_scrubbed(self) -> None:
        registry = self._registry()

        masked = mask_structure(
            {"response": {"headers": ["Authorization: s3cr3t-t0ken-99"], "status": 200}},
            registry,
        )

        assert masked == {"response": {"headers": ["Authorization: ********"], "status": 200}}

    def test_non_string_scalar_equal_to_registered_value_is_masked(self) -> None:
        registry = SecretRegistry()
        registry.register("account", 12345678, "declared")

        masked = mask_structure({"copied_number": 12345678}, registry)

        assert masked == {"copied_number": "********"}

    def test_decimal_equal_to_registered_value_is_masked(self) -> None:
        registry = SecretRegistry()
        registry.register("amount", Decimal("123456.75"), "declared")

        masked = mask_structure({"copied_amount": Decimal("123456.75")}, registry)

        assert masked == {"copied_amount": "********"}

    def test_boolean_leaves_pass_through(self) -> None:
        registry = self._registry()

        masked = mask_structure({"enabled": True}, registry)

        assert masked == {"enabled": True}

    def test_byte_transformed_value_passes_through(self) -> None:
        registry = self._registry()
        transformed = "s3cr3t-t0ken-99"[::-1]

        masked = mask_structure({"derived": transformed}, registry)

        assert masked == {"derived": transformed}

    def test_plain_values_are_untouched(self) -> None:
        registry = self._registry()

        masked = mask_structure({"plain": "hello world", "count": 3}, registry)

        assert masked == {"plain": "hello world", "count": 3}

    def test_short_scalar_secret_masks_by_flag_and_by_text(self) -> None:
        registry = SecretRegistry()
        registry.register("pin", "123", "declared")

        masked = mask_structure({"pin": "123", "note": "code 123 accepted"}, registry)

        assert masked == {"pin": "********", "note": "code ******** accepted"}

    def test_non_dict_payload_is_content_scrubbed(self) -> None:
        registry = self._registry()

        assert mask_structure("Bearer s3cr3t-t0ken-99", registry) == "Bearer ********"

    def test_a_secret_leaf_nested_past_the_depth_cap_is_scrubbed(self) -> None:
        registry = self._registry()
        deep: object = "s3cr3t-t0ken-99"
        for _ in range(120):
            deep = [deep]

        masked = mask_structure({"payload": deep}, registry)

        node = masked["payload"]
        for _ in range(120):
            node = node[0]
        assert node == MASK_PLACEHOLDER


def _vault_rows() -> Table:
    table = Table(columns=[("zt_login", "string"), ("zt_code", "string")])
    table.add_row(["zwadm", "kq4z"])
    return table


def _vault_registry() -> SecretRegistry:
    """A secret map, list and table whose cells sit under the scan floor."""
    registry = SecretRegistry()
    registry.register("vault_map", {"zm_login": "zwadm", "zm_code": "kq4z"}, "declared")
    registry.register("vault_list", ["zwadm", "kq4z"], "declared")
    registry.register("vault_rows", _vault_rows(), "declared")
    return registry


_SECRET_COPIES = [{"zm_login": "zwadm", "zm_code": "kq4z"}, ["zwadm", "kq4z"]]


class TestMaskStructureSecretContainerCopy:
    """An unflagged copy of a secret list, map or table collapses whole (REQ-3.1.3.5)."""

    @pytest.mark.parametrize("copy", _SECRET_COPIES, ids=["map", "list"])
    def test_a_copy_of_a_secret_container_collapses_to_the_bare_placeholder(
        self, copy: Any
    ) -> None:
        masked = mask_structure({"copied": copy}, _vault_registry())

        assert masked == {"copied": MASK_PLACEHOLDER}

    def test_a_copy_of_a_secret_table_collapses_to_the_bare_placeholder(self) -> None:
        masked = mask_structure({"copied_rows": _vault_rows()}, _vault_registry())

        assert masked == {"copied_rows": MASK_PLACEHOLDER}

    def test_a_copy_inside_a_plain_map_collapses_and_its_siblings_stay(self) -> None:
        value = {"creds": {"zm_login": "zwadm", "zm_code": "kq4z"}, "host": "example.local"}

        masked = mask_structure({"outer": value}, _vault_registry())

        assert masked == {"outer": {"creds": MASK_PLACEHOLDER, "host": "example.local"}}

    def test_a_container_derived_from_a_secret_is_not_a_copy(self) -> None:
        derived = {"reordered": ["kq4z", "zwadm"], "extended": ["zwadm", "kq4z", "more"]}

        masked = mask_structure(derived, _vault_registry())

        assert masked == derived

    def test_an_empty_container_is_never_a_copy(self) -> None:
        masked = mask_structure({"m": {}, "l": [], "t": Table()}, _vault_registry())

        assert masked["m"] == {}
        assert masked["l"] == []
        assert isinstance(masked["t"], Table)

    def test_a_plain_table_that_copies_no_secret_passes_as_a_table(self) -> None:
        table = Table(columns=[("region", "string")])
        table.add_row(["eu-west"])

        masked = mask_structure({"plain": table}, _vault_registry())

        assert masked == {"plain": table}

    def test_mask_values_collapses_a_copy_too(self) -> None:
        scan = _vault_registry().scan_values()

        masked = masking_module.mask_values({"creds": ["zwadm", "kq4z"], "n": 1}, scan)

        assert masked == {"creds": MASK_PLACEHOLDER, "n": 1}


class TestMaskWireStructure:
    """Variables on their way to a stored run: wire form, a secret copy whole, cells scrubbed."""

    def test_a_flagged_name_collapses_whatever_its_shape(self) -> None:
        masked = masking_module.mask_wire_structure(
            {"vault_rows": _vault_rows(), "vault_map": {"zm_login": "zwadm", "zm_code": "kq4z"}},
            _vault_registry(),
        )

        assert masked == {"vault_rows": MASK_PLACEHOLDER, "vault_map": MASK_PLACEHOLDER}

    @pytest.mark.parametrize("copy", [*_SECRET_COPIES, _vault_rows()], ids=["map", "list", "table"])
    def test_an_unflagged_copy_of_a_secret_container_collapses_whole(self, copy: Any) -> None:
        masked = masking_module.mask_wire_structure({"copied": copy}, _vault_registry())

        assert masked == {"copied": MASK_PLACEHOLDER}

    def test_a_plain_table_keeps_columns_and_rows_with_a_secret_cell_masked(self) -> None:
        registry = SecretRegistry()
        registry.register("login", "s3cretlogin99", "declared")
        table = Table(columns=[("name", "string"), ("token", "string"), ("port", "integer")])
        table.add_row(["payments-api", "s3cretlogin99", 8080])

        masked = masking_module.mask_wire_structure({"t": table}, registry)

        assert masked == {
            "t": {
                "columns": [
                    {"name": "name", "type": "string"},
                    {"name": "token", "type": "string"},
                    {"name": "port", "type": "integer"},
                ],
                "rows": [["payments-api", "********", 8080]],
            }
        }

    def test_a_table_row_equal_to_a_secret_list_keeps_the_row_shape(self) -> None:
        registry = SecretRegistry()
        registry.register("zones", ["eu-west-9z", "gold-tier-7"], "declared")
        table = Table(columns=[("region", "string"), ("tier", "string")])
        table.add_row(["eu-west-9z", "gold-tier-7"])

        masked = masking_module.mask_wire_structure({"t": table}, registry)

        assert masked["t"]["rows"] == [["********", "********"]]

    def test_a_copy_inside_a_plain_list_collapses_and_the_rest_takes_its_wire_form(self) -> None:
        value = [_vault_rows(), Decimal("1.50"), {"zm_login": "zwadm", "zm_code": "kq4z"}]

        masked = masking_module.mask_wire_structure({"mixed": value}, _vault_registry())

        assert masked == {"mixed": [MASK_PLACEHOLDER, "1.50", MASK_PLACEHOLDER]}

    def test_plain_values_take_their_wire_form(self) -> None:
        table = Table(columns=[("price", "float"), ("on", "boolean"), ("note", "string")])
        table.add_row([Decimal("2.5"), True, None])

        masked = masking_module.mask_wire_structure(
            {"t": table, "pair": ("a", 1), "n": None}, _vault_registry()
        )

        assert masked == {
            "t": {
                "columns": [
                    {"name": "price", "type": "float"},
                    {"name": "on", "type": "boolean"},
                    {"name": "note", "type": "string"},
                ],
                "rows": [["2.5", True, None]],
            },
            "pair": ["a", 1],
            "n": None,
        }

    def test_past_the_depth_cap_a_value_takes_its_wire_form_with_its_leaves_scrubbed(self) -> None:
        registry = SecretRegistry()
        registry.register("token", "s3cr3t-t0ken-99", "declared")
        deep: object = ["s3cr3t-t0ken-99", Decimal("1.50"), ("t", 1)]
        for _ in range(120):
            deep = [deep]

        masked = masking_module.mask_wire_structure({"payload": deep}, registry)

        node = masked["payload"]
        for _ in range(120):
            node = node[0]
        assert node == wire_values([MASK_PLACEHOLDER, Decimal("1.50"), ("t", 1)])

    def test_past_the_depth_cap_a_table_keeps_its_shape_with_a_secret_cell_masked(self) -> None:
        registry = _vault_registry()
        registry.register("login", "s3cretlogin99", "declared")
        table = Table(columns=[("zt_login", "string"), ("zt_code", "string")])
        table.add_row(["s3cretlogin99", "kq4z"])

        masked = masking_module.mask_wire_structure({"t": _nest(table, 120, as_map=True)}, registry)

        assert _descend(masked["t"], 120, as_map=True)["rows"] == [[MASK_PLACEHOLDER, "kq4z"]]


_MASK_PASSES: dict[str, Callable[[Any, SecretRegistry], Any]] = {
    "mask_values": lambda value, registry: masking_module.mask_values(
        value, registry.scan_values()
    ),
    "mask_wire_values": lambda value, registry: masking_module.mask_wire_values(
        value, registry.scan_values()
    ),
    "mask_structure": lambda value, registry: mask_structure({"v": value}, registry)["v"],
    "mask_wire_structure": lambda value, registry: masking_module.mask_wire_structure(
        {"v": value}, registry
    )["v"],
}


def _count_whole_form_builds(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    """Every value a masking pass builds the whole forms of, in build order."""
    built: list[Any] = []
    build = registry_module._whole_forms

    def counted(value: Any) -> Any:
        built.append(value)
        return build(value)

    monkeypatch.setattr(registry_module, "_whole_forms", counted)
    return built


def _count_seals(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """The head of every list, map and table form a pass digests, in order."""
    sealed: list[str] = []
    seal = registry_module._seal

    def counted(head: str, pieces: list[str]) -> str:
        sealed.append(head)
        return seal(head, pieces)

    monkeypatch.setattr(registry_module, "_seal", counted)
    return sealed


def _count_table_pieces(monkeypatch: pytest.MonkeyPatch) -> list[Table]:
    """Every table a pass digests, in order."""
    digested: list[Table] = []
    piece = registry_module.table_piece

    def counted(table: Table) -> Any:
        digested.append(table)
        return piece(table)

    monkeypatch.setattr(masking_module, "table_piece", counted)
    return digested


def _python_calls(run: Callable[[], Any]) -> int:
    """How many Python functions ``run`` calls on its way."""
    calls = 0

    def profile(_frame: Any, event: str, _arg: Any) -> None:
        nonlocal calls
        calls += event == "call"

    sys.setprofile(profile)
    try:
        run()
    finally:
        sys.setprofile(None)
    return calls


def _containers(value: Any) -> int:
    """How many lists and maps a value holds, itself included."""
    if isinstance(value, dict):
        return 1 + sum(_containers(item) for item in value.values())
    if isinstance(value, list):
        return 1 + sum(_containers(item) for item in value)
    return 0


def _values(value: Any) -> int:
    """How many values a value holds, itself included."""
    if isinstance(value, dict):
        return 1 + sum(_values(item) for item in value.values())
    if isinstance(value, list):
        return 1 + sum(_values(item) for item in value)
    return 1


def _number_records(count: int) -> list[dict[str, Any]]:
    """Records of numbers, dates, booleans and nulls: no leaf that holds text."""
    return [
        {
            "id": index,
            "rate": 2.5,
            "price": Decimal("1.50"),
            "day": date(2024, 1, 2),
            "on": True,
            "note": None,
            "ids": [index, 7],
        }
        for index in range(count)
    ]


def _pairs(depth: int, leaf: Any) -> Any:
    """A tree of 2-item lists ``depth`` levels deep, every bottom pair a copy of ``leaf``."""
    if depth == 1:
        return list(leaf)
    return [_pairs(depth - 1, leaf), _pairs(depth - 1, leaf)]


def _payload() -> dict[str, Any]:
    """Lists, maps and tables at several depths, none shaped like a vault secret."""
    wide = Table(columns=[("region", "string"), ("tier", "string"), ("zone", "string")])
    for index in range(30):
        wide.add_row([f"eu-west-{index}", "gold", "z1"])
    tall = Table(columns=[("host", "string"), ("port", "integer")])
    for index in range(40):
        tall.add_row([f"host-{index}", 8000 + index])
    return {
        "records": [
            {"id": index, "name": f"user-{index}", "tags": ["a", "b", "c"]} for index in range(50)
        ],
        "wide": wide,
        "tall": tall,
        "meta": {"auth": "Bearer s3cr3t-t0ken-99", "nested": {"deep": [[1, 2, 3]] * 3}},
    }


class TestMaskingPassCost:
    """A masking pass builds a whole form only where a secret container can match (REQ-3.1.3.5)."""

    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_with_no_secret_container_no_whole_form_is_built(
        self, name: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        registry = SecretRegistry()
        registry.register("token", "s3cr3t-t0ken-99", "declared")
        built = _count_whole_form_builds(monkeypatch)

        masked = _MASK_PASSES[name](_payload(), registry)

        assert built == []
        assert masked["meta"]["auth"] == "Bearer ********"

    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_a_value_no_secret_container_is_shaped_like_builds_no_whole_form(
        self, name: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        registry = _vault_registry()
        registry.register("token", "s3cr3t-t0ken-99", "declared")
        built = _count_whole_form_builds(monkeypatch)

        masked = _MASK_PASSES[name](_payload(), registry)

        assert built == []
        assert masked["meta"]["auth"] == "Bearer ********"

    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_values_shaped_like_a_secret_container_are_digested_and_never_encoded(
        self, name: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        lookalikes = [{"zm_login": f"user-{index}", "zm_code": "kq4z"} for index in range(3)]
        copy = {"zm_login": "zwadm", "zm_code": "kq4z"}
        payload = {"lookalikes": lookalikes, "outer": {"creds": copy}}
        registry = _vault_registry()
        built = _count_whole_form_builds(monkeypatch)
        sealed = _count_seals(monkeypatch)

        masked = _MASK_PASSES[name](payload, registry)

        assert built == []
        # Only the maps with the secret map's keys are digested: the 3 lookalikes and the copy.
        assert sealed == ["{2|"] * 4
        assert masked == {"lookalikes": lookalikes, "outer": {"creds": MASK_PLACEHOLDER}}

    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_a_map_with_other_keys_than_every_secret_map_is_never_digested(
        self, name: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        registry = SecretRegistry()
        registry.register("creds", {"user": "svc-admin", "password": "pw-123456-x"}, "declared")
        rows = Table(columns=[("id", "integer"), ("name", "string")])
        for index in range(40):
            rows.add_row([index, f"user-{index}"])
        sealed = _count_seals(monkeypatch)
        tables = _count_table_pieces(monkeypatch)

        masked = _MASK_PASSES[name]({"rows": rows, "count": 40}, registry)

        assert sealed == []
        assert tables == []
        assert masked["count"] == 40

    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_of_maps_the_size_of_a_secret_map_only_those_with_its_keys_are_digested(
        self, name: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        registry = SecretRegistry()
        registry.register("creds", {"user": "svc-admin", "password": "pw-123456-x"}, "declared")
        payload = [
            {"user": "ann", "password": "pw"},
            {"team": "ops", "ids": [1, 2]},
            {"user": "svc-admin", "password": "pw-123456-x"},
        ]
        sealed = _count_seals(monkeypatch)

        masked = _MASK_PASSES[name](payload, registry)

        assert sealed == ["{2|", "{2|"]
        assert masked == [*payload[:2], MASK_PLACEHOLDER]

    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_of_lists_the_size_of_a_secret_list_only_those_starting_like_it_are_digested(
        self, name: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        registry = SecretRegistry()
        registry.register("hosts", ["svc-a1x", "svc-b2y", "svc-c3z"], "declared")
        records = [
            {"id": index, "tags": ["a", "b", "c"], "ids": [index, 7, 8]} for index in range(20)
        ]
        payload = {
            "records": records,
            "near": ["svc-a1x", "svc-b2y", "other"],
            "copy": ["svc-a1x", "svc-b2y", "svc-c3z"],
        }
        sealed = _count_seals(monkeypatch)

        masked = _MASK_PASSES[name](payload, registry)

        # Of the 42 lists of 3 items, only the two that start with the secret list's item.
        assert sealed == ["[3|", "[3|"]
        assert masked == {
            "records": records,
            "near": [MASK_PLACEHOLDER, MASK_PLACEHOLDER, "other"],
            "copy": MASK_PLACEHOLDER,
        }

    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_of_number_pairs_only_the_one_starting_with_the_secret_pair_number_is_digested(
        self, name: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        registry = SecretRegistry()
        registry.register("point", [41.5, 2.25], "declared")
        pairs = [[float(index), 2.25] for index in range(30)]
        sealed = _count_seals(monkeypatch)

        masked = _MASK_PASSES[name]([*pairs, [41.5, 2.25]], registry)

        assert sealed == ["[2|"]
        assert masked[-1] == MASK_PLACEHOLDER
        assert len(masked) == 31 and masked[0] != MASK_PLACEHOLDER

    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_lists_starting_with_a_map_with_other_keys_are_never_digested(
        self, name: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        registry = SecretRegistry()
        registry.register("logins", [{"user": "svc-admin"}, {"user": "svc-ops"}], "declared")
        pages = [[{"page": index}, {"page": index + 1}] for index in range(20)]
        sealed = _count_seals(monkeypatch)

        masked = _MASK_PASSES[name](pages, registry)

        assert sealed == []
        assert masked == pages

    @pytest.mark.parametrize("name", ["mask_values", "mask_structure"])
    def test_with_only_single_value_secrets_each_value_costs_one_call(self, name: str) -> None:
        registry = SecretRegistry()
        registry.register("token", "s3cr3t-t0ken-99", "declared")
        small, large = _number_records(10), _number_records(30)

        extra = _python_calls(lambda: _MASK_PASSES[name](large, registry)) - _python_calls(
            lambda: _MASK_PASSES[name](small, registry)
        )

        # One call visits each value: a number, a date, true or null takes no other.
        assert extra == _values(large) - _values(small)
        assert _MASK_PASSES[name](large, registry) == large

    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_a_value_shaped_like_no_secret_container_is_never_digested(
        self, name: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        tall = Table(columns=[("zt_login", "string"), ("zt_code", "string")])
        for index in range(40):
            tall.add_row([f"user-{index}", "kq4z"])
        payload = {
            "records": [{"id": index, "name": "n", "tags": ["a", "b", "c"]} for index in range(50)],
            "tall": tall,
            "note": "Bearer s3cr3t-t0ken-99",
        }
        registry = _vault_registry()
        registry.register("token", "s3cr3t-t0ken-99", "declared")
        sealed = _count_seals(monkeypatch)

        masked = _MASK_PASSES[name](payload, registry)

        assert sealed == []
        assert masked["note"] == "Bearer ********"

    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_in_a_tree_of_pairs_only_the_pairs_starting_like_the_secret_pair_are_digested(
        self, name: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        registry = SecretRegistry()
        registry.register("pair", ["svc-user", "svc-pass-77"], "declared")
        tree = _pairs(8, ["svc-user", "svc-pass-77"])
        built = _count_whole_form_builds(monkeypatch)
        sealed = _count_seals(monkeypatch)

        masked = _MASK_PASSES[name](tree, registry)

        assert built == []
        # The pairs of pairs start with a list, the secret pair with a text: only the 128 copies.
        assert sealed == ["[2|"] * 2**7
        assert _descend(masked, 6, as_map=False) == [MASK_PLACEHOLDER, MASK_PLACEHOLDER]

    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_records_shaped_like_a_secret_record_are_each_digested_once(
        self, name: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        secret = {"id": 7, "name": "svc-admin", "tags": ["x", "y", "z"], "meta": {"ids": [1, 2]}}
        registry = SecretRegistry()
        registry.register("creds", secret, "declared")
        records = [
            {"id": index, "name": f"item-{index}", "tags": ["a", "b", "c"], "meta": {"ids": [1, 2]}}
            for index in range(30)
        ]
        payload = {"data": {"results": [*records, dict(secret)]}}
        sealed = _count_seals(monkeypatch)

        masked = _MASK_PASSES[name](payload, registry)

        # The maps around the records have other keys than the secret's maps: never digested.
        assert len(sealed) == _containers(payload["data"]["results"]) - 1
        assert masked["data"]["results"][-1] == MASK_PLACEHOLDER
        assert masked["data"]["results"][0]["meta"] == MASK_PLACEHOLDER

    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_each_table_shaped_like_a_secret_table_is_digested_once(
        self, name: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        tables = [_vault_rows() for _ in range(3)]
        tables[0].set_cell("other", 0, 0)
        digested: list[Any] = []
        piece = registry_module.table_piece

        def counted(table: Table) -> Any:
            digested.append(table)
            return piece(table)

        monkeypatch.setattr(masking_module, "table_piece", counted)

        masked = _MASK_PASSES[name]({"tables": tables}, _vault_registry())

        assert [id(table) for table in digested] == [id(table) for table in tables]
        assert masked["tables"][1:] == [MASK_PLACEHOLDER, MASK_PLACEHOLDER]


def _nest(leaf: Any, levels: int, as_map: bool) -> Any:
    value = leaf
    for _ in range(levels):
        value = {"k": value} if as_map else [value]
    return value


def _descend(value: Any, levels: int, as_map: bool) -> Any:
    for _ in range(levels):
        value = value["k"] if as_map else value[0]
    return value


class TestDepthCapBeforeWholeForms:
    """The depth cap stops a masking pass before any whole value is encoded."""

    _LEVELS = 600

    @pytest.mark.parametrize("as_map", [False, True], ids=["list", "map"])
    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_a_value_nested_past_the_cap_masks_its_leaf_without_overflowing(
        self, name: str, as_map: bool
    ) -> None:
        registry = _vault_registry()
        registry.register("token", "s3cr3t-t0ken-99", "declared")
        deep = _nest("s3cr3t-t0ken-99", self._LEVELS, as_map)

        masked = _MASK_PASSES[name](deep, registry)

        assert _descend(masked, self._LEVELS, as_map) == MASK_PLACEHOLDER

    @pytest.mark.parametrize("levels", [MAX_DEPTH, MAX_DEPTH + 1, 150, 3000])
    @pytest.mark.parametrize("secrets", ["single values", "with containers"])
    @pytest.mark.parametrize("as_map", [False, True], ids=["list", "map"])
    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_a_secret_leaf_at_any_depth_is_scrubbed_beside_plain_leaves(
        self, name: str, as_map: bool, secrets: str, levels: int
    ) -> None:
        registry = _vault_registry() if secrets == "with containers" else SecretRegistry()
        registry.register("token", "s3cr3t-t0ken-99", "declared")
        bottom = {"token": "Bearer s3cr3t-t0ken-99", "kept": "plain-leaf", "n": 7, "on": None}
        deep = _nest(bottom, levels, as_map)

        masked = _MASK_PASSES[name](deep, registry)

        expected = {"token": "Bearer ********", "kept": "plain-leaf", "n": 7, "on": None}
        assert _descend(masked, levels, as_map) == expected

    @pytest.mark.parametrize("secrets", ["single values", "with containers"])
    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_a_secret_leaf_right_at_the_cap_is_scrubbed(self, name: str, secrets: str) -> None:
        registry = _vault_registry() if secrets == "with containers" else SecretRegistry()
        registry.register("token", "s3cr3t-t0ken-99", "declared")

        masked = _MASK_PASSES[name](_nest("Bearer s3cr3t-t0ken-99", MAX_DEPTH, True), registry)

        assert _descend(masked, MAX_DEPTH, as_map=True) == "Bearer ********"

    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_a_secret_leaf_at_the_cap_inside_a_list_shaped_like_a_secret_list_is_scrubbed(
        self, name: str
    ) -> None:
        registry = _vault_registry()
        registry.register("token", "s3cr3t-t0ken-99", "declared")
        levels = MAX_DEPTH - 1
        deep = _nest(["zwadm", "s3cr3t-t0ken-99"], levels, as_map=False)

        masked = _MASK_PASSES[name](deep, registry)

        assert _descend(masked, levels, as_map=False) == ["zwadm", MASK_PLACEHOLDER]

    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_past_the_cap_a_tuple_is_scrubbed_as_the_list_it_travels_as(self, name: str) -> None:
        registry = SecretRegistry()
        registry.register("token", "s3cr3t-t0ken-99", "declared")
        deep = _nest(("s3cr3t-t0ken-99", 7), 150, as_map=True)

        masked = _MASK_PASSES[name](deep, registry)

        assert _descend(masked, 150, as_map=True) == [MASK_PLACEHOLDER, 7]

    def test_a_copy_inside_the_cap_still_collapses_whole(self) -> None:
        deep = _nest({"zm_login": "zwadm", "zm_code": "kq4z"}, 50, as_map=False)

        masked = mask_structure({"v": deep}, _vault_registry())

        assert _descend(masked["v"], 50, as_map=False) == MASK_PLACEHOLDER

    @pytest.mark.parametrize("levels", [900, 3000])
    @pytest.mark.parametrize("as_map", [False, True], ids=["list", "map"])
    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_a_value_nested_far_past_the_cap_masks_without_overflowing(
        self, name: str, as_map: bool, levels: int
    ) -> None:
        registry = _vault_registry()
        registry.register("token", "s3cr3t-t0ken-99", "declared")
        deep = _nest({"zm_login": "zwadm", "zm_code": "kq4z"}, levels, as_map)

        masked = _MASK_PASSES[name](deep, registry)

        assert _descend(masked, levels, as_map) == {"zm_login": "zwadm", "zm_code": "kq4z"}

    @pytest.mark.parametrize("as_map", [False, True], ids=["list", "map"])
    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_a_secret_nested_past_the_cap_masks_itself_without_overflowing(
        self, name: str, as_map: bool
    ) -> None:
        registry = SecretRegistry()
        registry.register("deep", _nest("d33p-s3cr3t-leaf", 900, as_map), "declared")
        deep = _nest("d33p-s3cr3t-leaf", self._LEVELS, as_map)

        masked = _MASK_PASSES[name](deep, registry)

        assert _descend(masked, self._LEVELS, as_map) == MASK_PLACEHOLDER
        inside = _MASK_PASSES[name](_nest("d33p-s3cr3t-leaf", 50, as_map), registry)
        assert inside == MASK_PLACEHOLDER


def _vault_print_form() -> dict[str, Any]:
    return {
        "columns": [
            {"name": "zt_login", "type": "string"},
            {"name": "zt_code", "type": "string"},
        ],
        "rows": [["zwadm", "kq4z"]],
    }


def _registry_of(value: Any) -> SecretRegistry:
    registry = SecretRegistry()
    registry.register("secret", value, "declared")
    return registry


_COPIES: dict[str, tuple[Callable[[], SecretRegistry], Any]] = {
    "a table copied as the rows it fills in": (
        _vault_registry,
        [{"zt_login": "zwadm", "zt_code": "kq4z"}],
    ),
    "a table copied as the columns and rows it prints": (_vault_registry, _vault_print_form()),
    "rows copied into a table": (
        lambda: _registry_of([{"zt_login": "zwadm", "zt_code": "kq4z"}]),
        _vault_rows(),
    ),
    "a map with number keys copied with text keys": (
        lambda: _registry_of({1: "alpha-code", 2: "beta-code"}),
        {"1": "alpha-code", "2": "beta-code"},
    ),
    "a map with text keys copied with number keys": (
        lambda: _registry_of({"1": "alpha-code", "2": "beta-code"}),
        {1: "alpha-code", 2: "beta-code"},
    ),
    "a map of columns and a table copied with the table's rows": (
        lambda: _registry_of({"columns": ["c-one"], "rows": _vault_rows()}),
        {"columns": ["c-one"], "rows": [{"zt_login": "zwadm", "zt_code": "kq4z"}]},
    ),
    "a map of columns and rows copied as the table it prints as": (
        lambda: _registry_of(_vault_print_form()),
        _vault_rows(),
    ),
    "a secret list copied as a tuple": (_vault_registry, ("zwadm", "kq4z")),
    "a one-item secret list copied as a tuple": (lambda: _registry_of(["kq4"]), ("kq4",)),
    "a secret tuple copied as a list": (lambda: _registry_of(("zwadm", "kq4z")), ["zwadm", "kq4z"]),
    "a float copied as the decimal it prints as": (
        lambda: _registry_of(["alpha", 1e-07]),
        ["alpha", Decimal("0.0000001")],
    ),
    "a map nested in a secret list": (
        lambda: _registry_of([{"zp_word": "kq4z"}, "other-item"]),
        {"zp_word": "kq4z"},
    ),
    "a list holding a table copied with the table's rows": (
        lambda: _registry_of([_vault_rows(), "tail-item"]),
        [[{"zt_login": "zwadm", "zt_code": "kq4z"}], "tail-item"],
    ),
    "a list holding a table copied with a copy of the table": (
        lambda: _registry_of([_vault_rows(), "tail-item"]),
        [_vault_rows(), "tail-item"],
    ),
    "a list holding a value that is not a number": (
        lambda: _registry_of(["n4n-item", float("nan"), None]),
        ["n4n-item", float("nan"), None],
    ),
    "a date copied as the text it prints as": (
        lambda: _registry_of(["dt-item", datetime(2020, 1, 2, 3, 4, 5)]),
        ["dt-item", "2020-01-02 03:04:05"],
    ),
    "a list starting with a float copied with the decimal it prints as": (
        lambda: _registry_of([1e-07, "alpha"]),
        [Decimal("0.0000001"), "alpha"],
    ),
    "a list starting with a date copied with the text it prints as": (
        lambda: _registry_of([datetime(2020, 1, 2, 3, 4, 5), "dt-item"]),
        ["2020-01-02 03:04:05", "dt-item"],
    ),
    "a list starting with a large float copied with the integer it prints as": (
        lambda: _registry_of([1e20, "big-item"]),
        [10**20, "big-item"],
    ),
    "a list starting with an integer too large for a float copied as a tuple": (
        lambda: _registry_of([10**400, "big-item"]),
        (10**400, "big-item"),
    ),
    "a list starting with a signaling NaN decimal copied whole": (
        lambda: _registry_of([Decimal("sNaN"), "nan-item"]),
        [Decimal("sNaN"), "nan-item"],
    ),
    "a list starting with a long text copied whole": (
        lambda: _registry_of(["a-long-secret-item-0001-xyz", "b"]),
        ("a-long-secret-item-0001-xyz", "b"),
    ),
    "a list starting with a map with number keys copied with text keys": (
        lambda: _registry_of([{1: "alpha-code"}, "tail-item"]),
        [{"1": "alpha-code"}, "tail-item"],
    ),
    "a list starting with a map copied as a table": (
        lambda: _registry_of([_vault_print_form(), "tail-item"]),
        [_vault_rows(), "tail-item"],
    ),
}


class TestCopiesInEveryForm:
    """A copy collapses whole when it prints or fills in as a secret container does."""

    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    @pytest.mark.parametrize("case", list(_COPIES))
    def test_a_copy_collapses_whole(self, case: str, name: str) -> None:
        make_registry, copy = _COPIES[case]

        assert _MASK_PASSES[name](copy, make_registry()) == MASK_PLACEHOLDER

    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_a_copy_at_the_last_level_inside_the_cap_collapses(self, name: str) -> None:
        levels = MAX_DEPTH - 1
        value = _nest(["zwadm", "kq4z"], levels, as_map=False)

        masked = _MASK_PASSES[name](value, _vault_registry())

        assert _descend(masked, levels, as_map=False) == MASK_PLACEHOLDER

    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_a_copy_holding_a_table_at_the_cap_collapses(self, name: str) -> None:
        levels = MAX_DEPTH - 1
        value = _nest([_vault_rows()], levels, as_map=False)

        masked = _MASK_PASSES[name](value, _registry_of([_vault_rows()]))

        assert _descend(masked, levels, as_map=False) == MASK_PLACEHOLDER

    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_a_table_with_no_rows_is_no_copy_of_a_map_it_prints_as(self, name: str) -> None:
        registry = _registry_of({"columns": [{"name": "zt_login", "type": "string"}], "rows": []})
        empty = Table(columns=[("zt_login", "string")])

        masked = _MASK_PASSES[name](empty, registry)

        assert masked != MASK_PLACEHOLDER

    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_a_copy_beside_a_sibling_nested_past_the_cap_collapses(self, name: str) -> None:
        value = [_nest("plain-leaf", 600, as_map=False), {"zm_login": "zwadm", "zm_code": "kq4z"}]

        masked = _MASK_PASSES[name](value, _vault_registry())

        assert masked[1] == MASK_PLACEHOLDER

    @pytest.mark.parametrize("name", list(_MASK_PASSES))
    def test_a_tuple_with_other_items_than_a_secret_list_keeps_its_items(self, name: str) -> None:
        masked = _MASK_PASSES[name](("zwadm", "other"), _vault_registry())

        assert masked == ["zwadm", "other"]

    def test_a_plain_table_keeps_its_shape_and_masks_a_secret_cell_beside_secret_containers(
        self,
    ) -> None:
        registry = _vault_registry()
        registry.register("login", "s3cretlogin99", "declared")
        table = Table(columns=[("zt_login", "string"), ("zt_code", "string")])
        table.add_row(["s3cretlogin99", "kq4z"])

        masked = masking_module.mask_wire_structure({"t": table}, registry)

        assert masked["t"]["rows"] == [["********", "kq4z"]]


class TestMaskWireValues:
    """One unflagged value in its wire form, masked by the registered forms."""

    def test_a_copy_of_a_secret_table_collapses_whole(self) -> None:
        scan = _vault_registry().scan_values()

        assert masking_module.mask_wire_values(_vault_rows(), scan) == MASK_PLACEHOLDER

    def test_map_keys_are_never_read_as_variable_names(self) -> None:
        registry = SecretRegistry()
        registry.register("token", "s3cr3t-t0ken-99", "declared")

        masked = masking_module.mask_wire_values({"token": "open"}, registry.scan_values())

        assert masked == {"token": "open"}

    def test_with_no_registered_forms_the_value_takes_its_wire_form(self) -> None:
        assert masking_module.mask_wire_values({"n": Decimal("1.50")}, ()) == {"n": "1.50"}


class TestMaskIoPayload:
    """Declaration-driven masking of the engine harness I/O lines
    (REQ-3.1.3.5, REQ-3.1.3.16). A key in ``secret_keys`` collapses its whole value to the
    placeholder; inside a dict value, entries whose lowercased key is in the
    plugin's credential-field catalog collapse individually while siblings stay
    readable. Everything else passes through unchanged and the input is untouched.
    """

    def test_secret_key_collapses_scalar_value_to_placeholder(self) -> None:
        result = masking_module.mask_io_payload(
            {"token": "s3cr3t-t0ken-99", "plain": "hello world"}, {"token"}, set()
        )

        assert result == {"token": "********", "plain": "hello world"}

    def test_secret_key_collapses_dict_value_without_exposing_keys(self) -> None:
        result = masking_module.mask_io_payload(
            {"creds": {"user": "u", "pass": "hunter2secret"}}, {"creds"}, set()
        )

        assert result == {"creds": "********"}

    def test_catalog_masks_matching_subkey_inside_dict_value(self) -> None:
        result = masking_module.mask_io_payload(
            {"headers": {"Authorization": "Bearer s3cr3t", "Content-Type": "application/json"}},
            set(),
            {"authorization"},
        )

        assert result == {
            "headers": {"Authorization": "********", "Content-Type": "application/json"}
        }

    def test_catalog_matches_subkey_case_insensitively(self) -> None:
        result = masking_module.mask_io_payload(
            {"headers": {"AUTHORIZATION": "Bearer s3cr3t"}}, set(), {"authorization"}
        )

        assert result == {"headers": {"AUTHORIZATION": "********"}}

    def test_catalog_leaves_non_catalog_subkeys_raw(self) -> None:
        result = masking_module.mask_io_payload(
            {"headers": {"X-Trace": "abc123", "Cookie": "sid=usr-c00kie-77"}},
            set(),
            {"cookie"},
        )

        assert result == {"headers": {"X-Trace": "abc123", "Cookie": "********"}}

    def test_catalog_does_not_touch_non_dict_values(self) -> None:
        result = masking_module.mask_io_payload(
            {"body": "authorization=s3cr3t-in-body"}, set(), {"authorization"}
        )

        assert result == {"body": "authorization=s3cr3t-in-body"}

    def test_secret_key_wins_over_catalog_for_a_dict_value(self) -> None:
        result = masking_module.mask_io_payload(
            {"headers": {"Authorization": "Bearer s3cr3t", "Content-Type": "application/json"}},
            {"headers"},
            {"authorization"},
        )

        assert result == {"headers": "********"}

    def test_empty_sets_pass_payload_through_unchanged(self) -> None:
        result = masking_module.mask_io_payload({"a": 1, "b": {"c": 2}, "d": "text"}, set(), set())

        assert result == {"a": 1, "b": {"c": 2}, "d": "text"}

    def test_input_payload_is_not_mutated(self) -> None:
        payload = {"headers": {"Authorization": "Bearer s3cr3t"}, "token": "s3cr3t-t0ken-99"}

        masking_module.mask_io_payload(payload, {"token"}, {"authorization"})

        assert payload == {
            "headers": {"Authorization": "Bearer s3cr3t"},
            "token": "s3cr3t-t0ken-99",
        }


class TestMaskValues:
    """value counterpart of ``mask_text``: recursively scrub registered byte-forms
    from a str / list / dict WITHOUT any name-flag masking. Feeds the I/O display
    lines so a value the name/catalog mask misses is scrubbed before it is repr'd.
    """

    def test_scrubs_a_string_leaf(self) -> None:
        assert (
            masking_module.mask_values("Bearer s3cr3t-t0ken-99", ("s3cr3t-t0ken-99",))
            == "Bearer ********"
        )

    def test_recurses_into_dict_values(self) -> None:
        result = masking_module.mask_values(
            {"header": "x s3cr3t-t0ken-99", "status": 200}, ("s3cr3t-t0ken-99",)
        )

        assert result == {"header": "x ********", "status": 200}

    def test_recurses_into_list_items(self) -> None:
        result = masking_module.mask_values(["a s3cr3t-t0ken-99", "b"], ("s3cr3t-t0ken-99",))

        assert result == ["a ********", "b"]

    def test_non_secret_value_passes_through(self) -> None:
        assert masking_module.mask_values("nothing here", ("s3cr3t-t0ken-99",)) == "nothing here"

    def test_empty_scan_values_returns_value_unchanged(self) -> None:
        assert masking_module.mask_values({"a": "text"}, ()) == {"a": "text"}


class TestReprEscapedScrub:
    """The value-scrub safety net catches a secret embedded in a repr'd container,
    where a dict/list str() escapes the secret's special chars. Guards the
    Inputs/Outputs debug-line leak at the log chokepoint (defense in depth)."""

    def test_repr_escaped_secret_in_a_dict_line_is_scrubbed(self) -> None:
        registry = SecretRegistry()
        secret = "x,y\n1,hello-s3cr3t-value"
        registry.register_value(secret, "var")

        line = f"Inputs: {{'message': {secret!r}, 'level': 'INFO'}}"
        result = mask_text(line, registry.scan_values())

        assert "hello-s3cr3t-value" not in result
        assert "********" in result

    def test_raw_secret_in_a_plain_line_still_scrubbed(self) -> None:
        registry = SecretRegistry()
        secret = "x,y\n1,hello-s3cr3t-value"
        registry.register_value(secret, "var")

        assert mask_text(f"{secret}", registry.scan_values()) == "********"

    def test_quote_flipped_secret_in_a_json_body_line_is_scrubbed(self) -> None:
        # A credential with an apostrophe interpolated into a JSON body (double
        # quotes) flips the enclosing repr delimiter and escapes the apostrophe,
        # so the secret's own-context escaped form no longer matches.
        registry = SecretRegistry()
        secret = "p@ss'w0rd-l0ng"
        registry.register_value(secret, "profile")

        body = '{"user": "admin", "password": "' + secret + '"}'
        line = f"Inputs: {{'body': {body!r}}}"
        result = mask_text(line, registry.scan_values())

        assert "w0rd-l0ng" not in result
        assert "********" in result


class TestMaskingSurface:
    """There is no reveal, config or per-channel filter API."""

    def test_there_is_no_reveal_control(self) -> None:
        assert not hasattr(masking_module, "SecretRevealControl")

    def test_there_is_no_masking_config(self) -> None:
        assert not hasattr(masking_module, "MaskingConfig")

    def test_there_is_no_masking_filter(self) -> None:
        assert not hasattr(masking_module, "MaskingFilter")

    def test_there_is_no_secret_mask_class(self) -> None:
        assert not hasattr(masking_module, "SecretMask")

    def test_package_exports_the_registry_and_mask_helpers(self) -> None:
        from wavecore.core.secrets import (  # noqa: F401
            MASK_PLACEHOLDER as pkg_placeholder,
        )
        from wavecore.core.secrets import (  # noqa: F401
            SecretRegistry as pkg_registry,
        )
        from wavecore.core.secrets import (  # noqa: F401
            mask_structure as pkg_mask_structure,
        )
        from wavecore.core.secrets import (  # noqa: F401
            mask_text as pkg_mask_text,
        )

        assert pkg_placeholder == "********"

    def test_package_exports_no_reveal_surface(self) -> None:
        import wavecore.core.secrets as secrets_package

        assert not hasattr(secrets_package, "SecretRevealControl")
        assert not hasattr(secrets_package, "MaskingFilter")
        assert not hasattr(secrets_package, "MaskingConfig")
        assert not hasattr(secrets_package, "SecretMask")
