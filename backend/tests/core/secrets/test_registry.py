"""
SecretRegistry contract tests (REQ-3.1.3.5, REQ-4.5.3).

The per-run registry holds three things: the set of variable NAMES flagged
secret for the run (flag-based structural masking), the set of string
forms of registered secret VALUES (text scrubbing), and a fixed-size digest
of each secret list, map or table (whole-copy masking). It is flat per-run
state - no scopes, no reveal, no source-store back ends.
"""

import random
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import pytest

import wavecore.core.secrets.registry as registry_module
from wavecore.core.expressions.template_escape import text_form
from wavecore.core.secrets.masking import MASK_PLACEHOLDER, mask_text, mask_values
from wavecore.core.secrets.registry import MAX_DEPTH, SecretRegistry
from wavecore.core.table import Table
from wavecore.core.variables.print_form import value_text


class TestNameFlagging:
    """mark_name / is_secret_name - the flag half of the registry."""

    def test_mark_name_flags_a_name(self) -> None:
        registry = SecretRegistry()
        registry.mark_name("token")

        assert registry.is_secret_name("token") is True

    def test_unmarked_name_is_not_secret(self) -> None:
        registry = SecretRegistry()

        assert registry.is_secret_name("token") is False

    def test_register_marks_the_name(self) -> None:
        registry = SecretRegistry()
        registry.register("token", "s3cr3t-t0ken-99", "declared")

        assert registry.is_secret_name("token") is True

    def test_mark_name_alone_adds_no_scan_values(self) -> None:
        registry = SecretRegistry()
        registry.mark_name("token")

        assert registry.scan_values() == ()

    def test_register_value_does_not_mark_any_name(self) -> None:
        registry = SecretRegistry()
        registry.register_value("tok-fr0m-plugin-99", "plugin:http-client")

        assert registry.is_secret_name("tok-fr0m-plugin-99") is False
        assert "tok-fr0m-plugin-99" in registry.scan_values()


class TestScanValueExtraction:
    """register / register_value scan-value extraction rules (REQ-4.5.3, length floor)."""

    def test_string_value_registers_its_exact_form(self) -> None:
        registry = SecretRegistry()
        registry.register("token", "s3cr3t-t0ken-99", "declared")

        assert "s3cr3t-t0ken-99" in registry.scan_values()

    def test_short_scalar_secret_registers_regardless_of_length(self) -> None:
        # A directly-registered secret scrubs at any non-empty length (no floor).
        registry = SecretRegistry()
        registry.register("pin", "abcde", "declared")

        assert "abcde" in registry.scan_values()

    def test_floor_applies_to_container_leaves_not_the_registered_scalar(self) -> None:
        # The SAME short value registers directly but not as an incidental leaf
        # inside a secret container (so it does not mask every occurrence in logs).
        scalar = SecretRegistry()
        scalar.register_value("ab", "var")
        assert "ab" in scalar.scan_values()

        container = SecretRegistry()
        container.register("headers", {"k": "ab", "token": "l0ng-en0ugh-value"}, "declared")
        assert "ab" not in container.scan_values()
        assert "l0ng-en0ugh-value" in container.scan_values()

    def test_six_char_value_is_at_the_floor_and_registers(self) -> None:
        registry = SecretRegistry()
        registry.register("pin", "abcdef", "declared")

        assert "abcdef" in registry.scan_values()

    def test_boolean_never_scan_registers(self) -> None:
        registry = SecretRegistry()
        registry.register("flag_true", True, "declared")
        registry.register("flag_false", False, "declared")

        assert registry.scan_values() == ()
        assert registry.is_secret_name("flag_true") is True

    def test_none_never_scan_registers(self) -> None:
        registry = SecretRegistry()
        registry.register("empty", None, "declared")

        assert registry.scan_values() == ()

    def test_empty_string_never_scan_registers(self) -> None:
        registry = SecretRegistry()
        registry.register("empty", "", "declared")

        assert registry.scan_values() == ()

    def test_integer_registers_its_string_form(self) -> None:
        registry = SecretRegistry()
        registry.register("account", 12345678, "declared")

        assert "12345678" in registry.scan_values()

    def test_short_integer_scalar_registers(self) -> None:
        registry = SecretRegistry()
        registry.register("port", 12345, "declared")

        assert "12345" in registry.scan_values()

    def test_float_registers_its_string_form(self) -> None:
        registry = SecretRegistry()
        registry.register("rate", 1234.5678, "declared")

        assert "1234.5678" in registry.scan_values()

    def test_decimal_registers_its_string_form(self) -> None:
        registry = SecretRegistry()
        registry.register("amount", Decimal("123456.75"), "declared")

        assert "123456.75" in registry.scan_values()

    def test_map_secret_registers_leaves_and_its_full_string_form(self) -> None:
        headers = {"Authorization": "Bearer t0ken-99", "Expires": "-1"}
        registry = SecretRegistry()
        registry.register("headers", headers, "declared")

        values = registry.scan_values()
        assert "Bearer t0ken-99" in values
        assert "-1" not in values
        assert str(headers) in values

    def test_a_secret_map_printed_by_wave_is_masked_whole(self) -> None:
        conf = {"host": "db.internal", "port": 5432}
        registry = SecretRegistry()
        registry.register("conf", conf, "declared")

        assert mask_text(value_text(conf), registry.scan_values()) == "********"

    def test_a_secret_list_of_maps_printed_by_wave_is_masked_whole_and_by_item(self) -> None:
        creds = [{"user": "ann", "pin": 1234}, {"user": "bob", "pin": 5678}]
        registry = SecretRegistry()
        registry.register("creds", creds, "declared")

        values = registry.scan_values()
        assert mask_text(value_text(creds), values) == "********"
        assert mask_text(f"first: {value_text(creds[0])}", values) == "first: ********"

    def test_a_secret_table_printed_by_wave_is_masked_whole(self) -> None:
        rows = Table.from_list([{"name": "alpha", "qty": 1}])
        registry = SecretRegistry()
        registry.register("rows", rows, "declared")

        assert mask_text(value_text(rows), registry.scan_values()) == "********"

    def test_an_empty_secret_table_registers_nothing(self) -> None:
        registry = SecretRegistry()
        registry.register("rows", Table.from_list([]), "declared")

        assert registry.scan_values() == ()

    def test_map_keys_are_not_registered(self) -> None:
        registry = SecretRegistry()
        registry.register("headers", {"Authorization-Key": "t0ken-value-99"}, "declared")

        assert "Authorization-Key" not in registry.scan_values()

    def test_array_secret_registers_each_leaf_and_its_full_string_form(self) -> None:
        tokens = ["t0ken-first-1", "t0ken-second-2"]
        registry = SecretRegistry()
        registry.register("tokens", tokens, "declared")

        values = registry.scan_values()
        assert "t0ken-first-1" in values
        assert "t0ken-second-2" in values
        assert str(tokens) in values

    def test_nested_container_registers_leaves_and_every_container_form(self) -> None:
        creds = [{"password": "nested-s3cr3t-1"}]
        registry = SecretRegistry()
        registry.register("creds", creds, "declared")

        values = registry.scan_values()
        assert "nested-s3cr3t-1" in values
        assert str(creds) in values
        assert str(creds[0]) in values

    def test_container_boolean_leaves_never_register(self) -> None:
        registry = SecretRegistry()
        registry.register("options", {"enabled": True}, "declared")

        values = registry.scan_values()
        assert "True" not in values
        assert str({"enabled": True}) in values

    def test_empty_container_forms_do_not_register(self) -> None:
        registry = SecretRegistry()
        registry.register("empty_map", {}, "declared")
        registry.register("empty_list", [], "declared")

        assert registry.scan_values() == ()

    @pytest.mark.parametrize(
        ("value", "digests"),
        [
            ({"user": "ann", "pin": 1234}, 1),
            (["ann", 1234], 1),
            (Table.from_list([{"name": "alpha", "qty": 1}]), 2),
        ],
        ids=["map", "list", "table"],
    )
    def test_a_secret_container_registers_its_whole_forms_and_its_digests(
        self, value: Any, digests: int
    ) -> None:
        from wavecore.core.expressions.template_escape import text_form

        registry = SecretRegistry()
        registry.register("creds", value, "declared")

        scan = registry.scan_values()
        assert {str(value), value_text(value), text_form(value)} <= set(scan)
        # A table prints as columns and rows and fills in as its rows: one digest each.
        assert len(scan.container_digests) == digests

    @pytest.mark.parametrize("value", [{}, [], Table(), "ann", 1234, None], ids=repr)
    def test_an_empty_container_or_a_scalar_registers_no_digest(self, value: Any) -> None:
        registry = SecretRegistry()
        registry.register("creds", value, "declared")

        assert registry.scan_values().container_digests == frozenset()

    def test_a_held_container_takes_its_digests_along_on_release(self) -> None:
        registry = SecretRegistry()
        registry.hold_name("call-1", "result")
        registry.register_written("result", {"zm_login": "zwadm", "zm_code": "kq4z"}, "output")
        assert registry.scan_values().container_digests

        registry.release("call-1")

        assert registry.scan_values().container_digests == frozenset()

    def test_a_container_exempt_in_one_block_is_recognized_everywhere_else(self) -> None:
        registry = SecretRegistry()
        registry.register_value(["zwadm-login", "kq4z-code"], "param:creds", exempt_block="b1")

        assert registry.scan_values(exclude_for_block="b1").container_digests == frozenset()
        assert registry.scan_values(exclude_for_block="b2").container_digests
        assert registry.scan_values().container_digests

    def test_scan_values_of_a_registry_compare_equal_to_a_plain_tuple(self) -> None:
        registry = SecretRegistry()
        registry.register("token", "s3cr3t-t0ken-99", "declared")

        assert registry.scan_values() == ("s3cr3t-t0ken-99",)

    def test_sub_floor_container_leaves_are_skipped(self) -> None:
        registry = SecretRegistry()
        registry.register(
            "headers",
            {"X-XSS-Protection": "0", "Token": "l0ng-en0ugh-t0ken"},
            "declared",
        )

        values = registry.scan_values()
        assert "0" not in values
        assert "l0ng-en0ugh-t0ken" in values


class TestScanValueOrdering:
    """scan_values ordering + dedupe (REQ-4.5.3)."""

    def test_scan_values_are_ordered_longest_first(self) -> None:
        registry = SecretRegistry()
        registry.register("short", "abcdef", "declared")
        registry.register("long", "abcdefghijkl", "declared")
        registry.register("mid", "abcdefgh", "declared")

        values = registry.scan_values()
        lengths = [len(value) for value in values]
        assert lengths == sorted(lengths, reverse=True)
        assert values[0] == "abcdefghijkl"

    def test_registering_the_same_value_twice_is_idempotent(self) -> None:
        registry = SecretRegistry()
        registry.register("token", "s3cr3t-t0ken-99", "declared")
        registry.register_value("s3cr3t-t0ken-99", "plugin:http-client")

        assert list(registry.scan_values()).count("s3cr3t-t0ken-99") == 1


class TestSources:
    """Designation sources are retained for inspection surfaces."""

    def test_register_retains_the_source_for_the_name(self) -> None:
        registry = SecretRegistry()
        registry.register("token", "s3cr3t-t0ken-99", "declared")

        assert registry.sources["token"] == "declared"

    def test_reregistration_updates_the_source(self) -> None:
        registry = SecretRegistry()
        registry.register("token", "s3cr3t-t0ken-99", "declared")
        registry.register("token", "t0ken-rewritten-1", "output:http-client")

        assert registry.sources["token"] == "output:http-client"
        assert "s3cr3t-t0ken-99" in registry.scan_values()
        assert "t0ken-rewritten-1" in registry.scan_values()


class TestBlockExemptions:
    """A value registered with an exempt block scrubs everywhere except that
    block's own display lines (block-scoped per-field reveal)."""

    def test_exempted_value_still_registers_globally(self) -> None:
        registry = SecretRegistry()
        registry.register_value("tok-3x3mpt-11", "plugin:http-client", exempt_block="blk-a")

        assert "tok-3x3mpt-11" in registry.scan_values()

    def test_scan_for_the_exempt_block_omits_the_value(self) -> None:
        registry = SecretRegistry()
        registry.register_value("tok-3x3mpt-11", "plugin:http-client", exempt_block="blk-a")

        assert "tok-3x3mpt-11" not in registry.scan_values(exclude_for_block="blk-a")

    def test_scan_for_another_block_keeps_the_value(self) -> None:
        registry = SecretRegistry()
        registry.register_value("tok-3x3mpt-11", "plugin:http-client", exempt_block="blk-a")

        assert "tok-3x3mpt-11" in registry.scan_values(exclude_for_block="blk-b")

    def test_container_exemption_covers_every_form(self) -> None:
        registry = SecretRegistry()
        value = {"cookie": "tok-c0nta1n3r-22"}
        registry.register_value(value, "plugin:http-client", exempt_block="blk-a")

        exempted = registry.scan_values(exclude_for_block="blk-a")
        assert str(value) not in exempted
        assert "tok-c0nta1n3r-22" not in exempted
        assert "tok-c0nta1n3r-22" in registry.scan_values()

    def test_unexempted_registrations_are_unaffected(self) -> None:
        registry = SecretRegistry()
        registry.register("token", "tok-plain-33", "declared")
        registry.register_value("tok-3x3mpt-11", "plugin:http-client", exempt_block="blk-a")

        assert "tok-plain-33" in registry.scan_values(exclude_for_block="blk-a")

    def test_plain_registration_of_the_same_value_wins_over_exemption(self) -> None:
        """Once ANY unexempted carrier registers the bytes, no block reveals them."""
        registry = SecretRegistry()
        registry.register_value("tok-sh4r3d-44", "plugin:http-client", exempt_block="blk-a")
        registry.register("token", "tok-sh4r3d-44", "declared")

        assert "tok-sh4r3d-44" in registry.scan_values(exclude_for_block="blk-a")


class TestReprEscapedForms:
    """A string secret embedded in a repr'd container (dict/list) escapes its
    special chars - newline -> ``\\n``, tab, carriage-return, quote, backslash.
    The value-scrub is a raw-byte replace, so it misses that escaped form unless
    the escaped form is registered too. Guards the Inputs/Outputs debug-line leak.
    """

    def test_newline_value_registers_both_raw_and_escaped_forms(self) -> None:
        registry = SecretRegistry()
        secret = "line1\nline2-s3cr3t-value"
        registry.register_value(secret, "var")

        values = registry.scan_values()
        assert secret in values
        assert repr(secret)[1:-1] in values
        assert repr(secret)[1:-1] != secret

    def test_tab_value_registers_escaped_form(self) -> None:
        registry = SecretRegistry()
        secret = "col1\tcol2-s3cr3t-value"
        registry.register_value(secret, "var")

        assert repr(secret)[1:-1] in registry.scan_values()
        assert repr(secret)[1:-1] != secret

    def test_backslash_value_registers_escaped_form(self) -> None:
        registry = SecretRegistry()
        secret = "C:\\path\\to\\s3cr3t-file"
        registry.register_value(secret, "var")

        assert repr(secret)[1:-1] in registry.scan_values()
        assert repr(secret)[1:-1] != secret

    def test_mixed_quote_value_registers_escaped_form(self) -> None:
        registry = SecretRegistry()
        secret = "say 'hi' and \"bye\"-s3cr3t-value"
        registry.register_value(secret, "var")

        assert repr(secret)[1:-1] in registry.scan_values()
        assert repr(secret)[1:-1] != secret

    def test_value_without_escapable_chars_adds_no_duplicate(self) -> None:
        registry = SecretRegistry()
        registry.register_value("s3cr3t-t0ken-99", "var")

        assert registry.scan_values() == ("s3cr3t-t0ken-99",)

    def test_escaped_form_is_block_exempted_with_its_raw_form(self) -> None:
        registry = SecretRegistry()
        secret = "line1\ns3cr3t-exempt-line"
        registry.register_value(secret, "plugin", exempt_block="blk-a")

        escaped = repr(secret)[1:-1]
        assert escaped in registry.scan_values()
        assert escaped not in registry.scan_values(exclude_for_block="blk-a")

    def test_short_scalar_secret_registers_raw_and_escaped(self) -> None:
        # No floor for a directly-registered secret: even a 3-char value with a
        # newline registers both its raw and repr-escaped forms.
        registry = SecretRegistry()
        registry.register_value("a\nb", "var")

        values = registry.scan_values()
        assert "a\nb" in values
        assert "a\\nb" in values

    def test_apostrophe_value_registers_the_single_quote_context_form(self) -> None:
        # An apostrophe-bearing secret embedded in a double-quoted string flips the
        # enclosing repr to single-quote delimiters, escaping the apostrophe as \'.
        registry = SecretRegistry()
        secret = "p@ss'w0rd-l0ng"
        registry.register_value(secret, "profile")

        values = registry.scan_values()
        assert secret in values
        assert "p@ss\\'w0rd-l0ng" in values

    def test_double_quote_value_registers_the_double_quote_context_form(self) -> None:
        registry = SecretRegistry()
        secret = 'say "hi"-s3cr3t-value'
        registry.register_value(secret, "profile")

        values = registry.scan_values()
        assert secret in values
        assert 'say \\"hi\\"-s3cr3t-value' in values


class TestJsonEscapedForms:
    """A string secret in JSON text, such as WAVE's print form, escapes its control characters."""

    def test_control_character_value_registers_its_json_escaped_form(self) -> None:
        registry = SecretRegistry()
        registry.register("token", "pa\bss\fw\x01rd", "declared")

        assert r"pa\bss\fw\u0001rd" in registry.scan_values()

    def test_a_secret_leaf_printed_inside_another_map_is_masked(self) -> None:
        registry = SecretRegistry()
        registry.register("keys", ["k3y\bvalue", "other-v4lue"], "declared")

        printed = value_text({"user": "ann", "key": "k3y\bvalue"})

        assert mask_text(printed, registry.scan_values()) == '{"user":"ann","key":"********"}'


class TestJsonFillForms:
    """A secret list, map or table filled alone in a JSON template masks whole (REQ-3.3.2.6)."""

    @pytest.mark.parametrize(
        ("value", "filled"),
        [
            (Table.from_list([{"name": "alpha", "qty": 1}]), '[{"name":"alpha","qty":1}]'),
            (["alpha", 1e-07], '["alpha",1e-07]'),
            ({"host": "db.internal", "rate": 1e-07}, '{"host":"db.internal","rate":1e-07}'),
        ],
        ids=["table", "list", "map"],
    )
    def test_the_text_a_json_fill_writes_is_masked_whole(self, value: Any, filled: str) -> None:
        registry = SecretRegistry()
        registry.register("rows", value, "declared")

        query = '{"terms": ' + filled + "}"

        assert mask_text(query, registry.scan_values()) == '{"terms": ********}'


class TestHeldNames:
    """A name a holder holds (a Function call's secret output) is secret, and the values
    written to it scrub, only until the holder releases it (SECUI-11)."""

    CALL = ("fn-1",)
    INNER = ("fn-1", "fn-2")

    def test_a_held_name_is_secret_until_released(self) -> None:
        registry = SecretRegistry()
        registry.hold_name(self.CALL, "out_tok")

        assert registry.is_secret_name("out_tok") is True
        registry.release(self.CALL)
        assert registry.is_secret_name("out_tok") is False

    def test_a_value_written_to_a_held_name_scrubs_until_released(self) -> None:
        registry = SecretRegistry()
        registry.hold_name(self.CALL, "out_tok")
        registry.register_written("out_tok", "0ut-v4lue-55", "write")

        assert "0ut-v4lue-55" in registry.scan_values()
        registry.release(self.CALL)
        assert "0ut-v4lue-55" not in registry.scan_values()

    def test_a_value_written_to_a_run_secret_name_stays_for_the_run(self) -> None:
        registry = SecretRegistry()
        registry.mark_name("token")
        registry.register_written("token", "t0ken-v4lue-66", "write")
        registry.release(self.CALL)

        assert "t0ken-v4lue-66" in registry.scan_values()
        assert registry.sources["token"] == "write"

    def test_a_value_written_to_a_plain_name_registers_nothing(self) -> None:
        registry = SecretRegistry()
        registry.register_written("plain", "pl41n-v4lue-77", "write")

        assert registry.scan_values() == ()
        assert registry.is_secret_name("plain") is False

    def test_a_run_secret_name_a_call_also_holds_stays_secret_after_release(self) -> None:
        registry = SecretRegistry()
        registry.mark_name("out_tok")
        registry.hold_name(self.CALL, "out_tok")
        registry.release(self.CALL)

        assert registry.is_secret_name("out_tok") is True

    def test_release_keeps_a_value_also_registered_for_the_run(self) -> None:
        registry = SecretRegistry()
        registry.hold_name(self.CALL, "out_tok")
        registry.register_written("out_tok", "sh4r3d-v4lue-88", "write")
        registry.register_value("sh4r3d-v4lue-88", "output:function")
        registry.release(self.CALL)

        assert "sh4r3d-v4lue-88" in registry.scan_values()

    def test_release_keeps_what_another_holder_holds(self) -> None:
        registry = SecretRegistry()
        registry.hold_name(self.CALL, "out_tok")
        registry.hold_name(self.INNER, "inner_tok")
        registry.register_written("inner_tok", "1nn3r-v4lue-99", "write")
        registry.release(self.CALL)

        assert registry.is_secret_name("inner_tok") is True
        assert "1nn3r-v4lue-99" in registry.scan_values()

    def test_the_latest_holder_of_a_name_holds_its_writes(self) -> None:
        registry = SecretRegistry()
        registry.hold_name(self.CALL, "out_tok")
        registry.hold_name(self.INNER, "out_tok")
        registry.register_written("out_tok", "n3st3d-v4lue-10", "write")

        registry.release(self.CALL)
        assert "n3st3d-v4lue-10" in registry.scan_values()
        registry.release(self.INNER)
        assert "n3st3d-v4lue-10" not in registry.scan_values()

    def test_a_held_value_is_never_block_exempted(self) -> None:
        registry = SecretRegistry()
        registry.register_value("ex3mpt-h3ld-12", "plugin:http-client", exempt_block="blk-a")
        registry.hold_name(self.CALL, "out_tok")
        registry.register_written("out_tok", "ex3mpt-h3ld-12", "write")

        assert "ex3mpt-h3ld-12" in registry.scan_values(exclude_for_block="blk-a")

    def test_a_write_goes_to_the_holder_of_that_name(self) -> None:
        registry = SecretRegistry()
        registry.hold_name(self.CALL, "out_tok")
        registry.hold_name(self.INNER, "inner_tok")
        registry.register_written("out_tok", "0ut3r-v4lue-13", "write")

        registry.release(self.INNER)
        assert "0ut3r-v4lue-13" in registry.scan_values()
        registry.release(self.CALL)
        assert "0ut3r-v4lue-13" not in registry.scan_values()


def _texts(state: Any) -> list[str]:
    """Every text reachable from a registry's state."""
    found: list[str] = []
    stack = [state]
    while stack:
        item = stack.pop()
        if isinstance(item, str):
            found.append(item)
        elif isinstance(item, dict):
            stack.extend([*item.keys(), *item.values()])
        elif isinstance(item, list | tuple | set | frozenset):
            stack.extend(item)
        elif hasattr(item, "__slots__"):
            stack.extend(getattr(item, slot) for slot in item.__slots__)
        elif hasattr(item, "__dict__"):
            stack.append(vars(item))
    return found


_DIGEST = re.compile("d[0-9a-f]{32}")


def _count_seals(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """The head of every list, map and table form digested, in order."""
    sealed: list[str] = []
    seal = registry_module._seal

    def counted(head: str, pieces: list[str]) -> str:
        sealed.append(head)
        return seal(head, pieces)

    monkeypatch.setattr(registry_module, "_seal", counted)
    return sealed


class TestContainerDigests:
    """A copy of a secret list, map or table is recognized by fixed-size digests (REQ-3.1.3.5)."""

    SECRET = {
        "login": "svc-l0gin-77",
        "payload": "pa7load-" * 40,
        "codes": ["c0de-one-1", "c0de-two-2"],
    }

    def test_the_digests_are_fixed_size_and_hold_no_text_of_the_container(self) -> None:
        registry = SecretRegistry()
        registry.register("creds", self.SECRET, "declared")

        scan = registry.scan_values()
        assert len(scan.container_digests) == 2
        assert all(_DIGEST.fullmatch(digest) for digest in scan.container_digests)
        # The shape facts name a bracket, a count and a fixed-size digest: of a map's keys, of how
        # a list's first item starts. No text.
        facts = sorted(scan.container_facts)
        assert [entry[:2] for entry in facts] == [("[", 2), ("{", 3)]
        assert all(len(entry) == 3 and isinstance(entry[-1], int) for entry in facts)

    def test_the_key_digest_of_a_map_reads_its_keys_as_text_in_any_order(self) -> None:
        def facts_of(value: Any) -> Any:
            registry = SecretRegistry()
            registry.register("creds", value, "declared")
            return registry.scan_values().container_facts

        assert facts_of({1: "alpha-code", "b": "beta-code"}) == facts_of(
            {"b": "beta-code", "1": "alpha-code"}
        )
        assert facts_of({"a": "alpha-code", "b": "beta-code"}) != facts_of(
            {"a": "alpha-code", "c": "beta-code"}
        )

    def test_the_text_kept_of_a_run_secret_container_is_only_what_scrubbing_needs(self) -> None:
        registry = SecretRegistry()
        registry.register("creds", self.SECRET, "declared")

        kept = {text for text in _texts(registry) if "svc-l0gin-77" in text}
        assert kept <= set(registry.scan_values())

    def test_a_released_holder_leaves_no_text_and_no_digest_of_its_container(self) -> None:
        registry = SecretRegistry()
        for index in range(3):
            holder = f"call-{index}"
            registry.hold_name(holder, "result")
            registry.register_written("result", {**self.SECRET, "n": index}, "output")
            registry.release(holder)

        texts = _texts(registry)
        assert [text for text in texts if "svc-l0gin-77" in text or "pa7load-" in text] == []
        assert [text for text in texts if _DIGEST.fullmatch(text)] == []
        assert registry.scan_values() == ()
        assert registry.scan_values().container_digests == frozenset()

    def test_release_keeps_the_digests_another_holder_or_the_run_holds(self) -> None:
        registry = SecretRegistry()
        registry.register("run_list", ["run-l0gin-1", "run-c0de-2"], "declared")
        registry.hold_name("call-1", "out")
        registry.hold_name("call-2", "inner")
        registry.register_written("out", ["out-l0gin-1", "out-c0de-2"], "output")
        registry.register_written("inner", ["inn-l0gin-1", "inn-c0de-2"], "output")

        registry.release("call-1")

        scan = registry.scan_values()
        assert mask_values(["run-l0gin-1", "run-c0de-2"], scan) == MASK_PLACEHOLDER
        assert mask_values(["inn-l0gin-1", "inn-c0de-2"], scan) == MASK_PLACEHOLDER
        assert mask_values(["out-l0gin-1", "out-c0de-2"], scan) == ["out-l0gin-1", "out-c0de-2"]

    def test_each_container_of_a_secret_is_digested_once_when_it_registers(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        sealed = _count_seals(monkeypatch)
        registry = SecretRegistry()

        registry.register(
            "creds", [{"a": ["x1-s3cret", "x2-s3cret"]}, {"b": ["y1-s3cret"]}], "declared"
        )

        assert sorted(sealed) == ["[1|", "[2|", "[2|", "{1|", "{1|"]


def _leads(item: Any) -> set[int]:
    lead = registry_module.lead_digest(item)
    return {lead} if isinstance(lead, int) else set(lead)


def _vault_table() -> Table:
    table = Table(columns=[("zt_login", "string"), ("zt_code", "string")])
    table.add_row(["zwadm", "kq4z"])
    return table


class TestListLeads:
    """A list is digested only when its first item starts like a secret list's (REQ-3.1.3.5)."""

    @pytest.mark.parametrize(
        ("first", "twin"),
        [
            (10**20, 1e20),
            (Decimal("0.0000001"), 1e-07),
            (0, -0.0),
            (3, Decimal("3")),
            (10**400, 10**400),
            (float("inf"), Decimal("Infinity")),
            (float("nan"), Decimal("NaN")),
            (Decimal("sNaN"), Decimal("sNaN")),
            (None, None),
            (datetime(2020, 1, 2, 3, 4, 5), "2020-01-02 03:04:05"),
            ("a-text-longer-than-sixteen-characters", "a-text-longer-than-sixteen-characters"),
            ({1: "alpha-code"}, {"1": "alpha-code"}),
            (("zwadm", "kq4z"), ["zwadm", "kq4z"]),
            (_vault_table(), {"columns": [], "rows": []}),
            (_vault_table(), [{"zt_login": "zwadm", "zt_code": "kq4z"}]),
        ],
    )
    def test_items_that_write_the_same_text_start_a_list_alike(self, first: Any, twin: Any) -> None:
        assert _leads(first) & _leads(twin)

    @pytest.mark.parametrize(
        ("first", "other"),
        [
            ("svc-user", 7),
            ("svc-user", "svc-other"),
            (41.5, 42.5),
            ({"user": "x"}, {"page": 1}),
            ([1, 2], [1, 2, 3]),
            (7, None),
        ],
    )
    def test_items_that_start_otherwise_have_other_digests(self, first: Any, other: Any) -> None:
        assert not _leads(first) & _leads(other)

    def test_the_leads_of_a_size_skip_first_items_of_a_kind_no_secret_list_starts_with(
        self,
    ) -> None:
        registry = SecretRegistry()
        registry.register("pair", ["svc-user", "svc-pass-77"], "declared")
        registry.register("point", [{"x": 1}, {"y": 2}], "declared")

        leads = registry.scan_values().list_leads[2]

        assert leads.skipped == {int, float, bool, Decimal, type(None), list, tuple}
        assert leads.started_by("svc-user")
        assert not leads.started_by("svc-other")
        assert leads.started_by({"x": 5})
        assert not leads.started_by({"z": 5})

    def test_a_table_of_a_size_starts_a_list_as_its_rows_do(self) -> None:
        registry = SecretRegistry()
        registry.register("rows", _vault_table(), "declared")

        leads = registry.scan_values().list_leads[1]

        assert leads.started_by({"zt_login": "other", "zt_code": "other"})
        assert not leads.started_by({"zt_login": "other"})


class TestShapeFacts:
    """The shapes a secret list or map shows come as one list of facts, one or two of them."""

    def test_a_plain_map_shows_its_size_and_the_digest_of_its_keys(self) -> None:
        value = {"user": "svc-user", "pass": "svc-pass-77"}

        assert registry_module.map_facts(value) == [("{", 2, registry_module.key_digest(value))]

    def test_a_map_of_columns_and_rows_shows_a_tables_shape_too(self) -> None:
        value = {"columns": [{"name": "a"}, {"name": "b"}], "rows": [[1, 2], [3, 4], [5, 6]]}

        assert registry_module.map_facts(value) == [
            ("{", 2, registry_module.key_digest(value)),
            ("T", 3, 2),
        ]

    def test_a_map_of_columns_and_rows_that_are_not_lists_shows_only_its_own_shape(
        self,
    ) -> None:
        value = {"columns": "a", "rows": "b"}

        assert registry_module.map_facts(value) == [("{", 2, registry_module.key_digest(value))]

    def test_a_list_shows_its_size_with_how_its_first_item_starts(self) -> None:
        assert registry_module.branch_facts(["svc-user", "svc-pass-77"]) == [
            ("[", 2, registry_module.lead_digest("svc-user"))
        ]

    def test_a_list_led_by_a_table_shows_one_shape_for_each_form_of_the_table(self) -> None:
        table = _vault_table()
        lead = registry_module.lead_digest(table)
        assert isinstance(lead, tuple)
        printed, filled = lead

        assert registry_module.branch_facts([table]) == [("[", 1, printed), ("[", 1, filled)]


class TestLeafPieces:
    """A float writes one piece when its plain text and its repr match, else both in turn."""

    @pytest.mark.parametrize(
        ("value", "piece"),
        [
            (1.5, "b3:1.5"),
            (100.0, "b5:100.0"),
            (-0.0, "b4:-0.0"),
            (0.0001, "b6:0.0001"),
            (1234567890123456.0, "b18:1234567890123456.0"),
        ],
    )
    def test_a_float_whose_two_texts_match_writes_one_piece(self, value: float, piece: str) -> None:
        assert registry_module.leaf_piece(value) == piece

    @pytest.mark.parametrize(
        ("value", "pieces"),
        [
            (1e-05, ("b7:0.00001", "b5:1e-05")),
            (1e16, ("b17:10000000000000000", "b5:1e+16")),
            (-2.5e-07, ("b11:-0.00000025", "b8:-2.5e-07")),
        ],
    )
    def test_a_float_in_exponent_notation_writes_its_plain_piece_then_its_repr_piece(
        self, value: float, pieces: tuple[str, str]
    ) -> None:
        assert registry_module.leaf_piece(value) == pieces


def _nest(leaf: Any, levels: int, as_map: bool) -> Any:
    value = leaf
    for _ in range(levels):
        value = {"k": value} if as_map else [value]
    return value


class TestDeepSecrets:
    """A secret nested past the masking depth registers without overflowing (REQ-3.1.3.5)."""

    LEAF = "d33p-s3cr3t-leaf"

    @pytest.mark.parametrize("levels", [600, 900, 3000, 10000])
    @pytest.mark.parametrize("as_map", [False, True], ids=["list", "map"])
    def test_a_deep_secret_registers_and_its_leaf_still_scrubs(
        self, levels: int, as_map: bool
    ) -> None:
        registry = SecretRegistry()

        registry.register("deep", _nest(self.LEAF, levels, as_map), "declared")

        assert mask_text(f"got {self.LEAF} back", registry.scan_values()) == "got ******** back"

    @pytest.mark.parametrize("as_map", [False, True], ids=["list", "map"])
    def test_only_the_containers_within_the_masking_depth_register_digests(
        self, as_map: bool
    ) -> None:
        secret = _nest(self.LEAF, 600, as_map)
        registry = SecretRegistry()

        registry.register("deep", secret, "declared")

        scan = registry.scan_values()
        assert len(scan.container_digests) == MAX_DEPTH
        assert value_text(_nest(self.LEAF, MAX_DEPTH, as_map)) in scan
        assert str(secret) in scan
        assert mask_values(_nest(self.LEAF, 50, as_map), scan) == MASK_PLACEHOLDER

    def test_items_after_a_deep_item_still_register_and_the_map_has_no_digest(self) -> None:
        value = {"deep": _nest(self.LEAF, 600, as_map=False), "next": "n3xt-s3cret-leaf"}
        registry = SecretRegistry()

        registry.register("deep", value, "declared")

        scan = registry.scan_values()
        assert "n3xt-s3cret-leaf" in scan
        assert len(scan.container_digests) == MAX_DEPTH
        assert [facts for facts in scan.container_facts if facts[0] == "{"] == []
        assert str(value) in scan

    @pytest.mark.parametrize("as_map", [False, True], ids=["list", "map"])
    def test_a_secret_taller_than_the_masking_depth_printed_whole_shows_one_placeholder(
        self, as_map: bool
    ) -> None:
        secret = _nest({"pin": "kq4z"}, 150, as_map)
        registry = SecretRegistry()

        registry.register("tall", secret, "declared")

        scan = registry.scan_values()
        for printed in (str(secret), value_text(secret), text_form(secret)):
            assert mask_text(f"payload {printed}", scan) == "payload ********"

    @pytest.mark.parametrize("as_map", [False, True], ids=["list", "map"])
    def test_a_secret_900_levels_deep_printed_whole_shows_one_placeholder(
        self, as_map: bool
    ) -> None:
        secret = _nest({"pin": "kq4z"}, 900, as_map)
        registry = SecretRegistry()

        registry.register("tall", secret, "declared")

        assert mask_text(f"payload {secret}", registry.scan_values()) == "payload ********"

    def test_every_form_of_a_tall_secret_of_any_content_prints_as_one_placeholder(self) -> None:
        rng = random.Random(5)
        for _ in range(25):
            secret = _tall_secret(rng)
            registry = SecretRegistry()

            registry.register("tall", secret, "declared")

            scan = registry.scan_values()
            for printed in (str(secret), value_text(secret), text_form(secret)):
                assert mask_text(printed, scan) == MASK_PLACEHOLDER, printed[:200]

    def test_a_tall_tuple_in_a_secret_registers_without_overflowing(self) -> None:
        tall: Any = self.LEAF
        for _ in range(3000):
            tall = (tall,)
        registry = SecretRegistry()

        registry.register("deep", [tall, "s1bling-s3cret"], "declared")

        scan = registry.scan_values()
        assert mask_text(f"got {self.LEAF} and s1bling-s3cret", scan) == "got ******** and ********"


_TALL_LEAVES: list[Any] = [
    "plain",
    'q"uote\\s',
    "it's",
    "\u00e9-text",
    "ctl\x01\n",
    0,
    -12,
    10**20,
    1.5,
    1e-07,
    1e20,
    float("nan"),
    float("inf"),
    -0.0,
    Decimal("1.50"),
    Decimal("1E+3"),
    True,
    False,
    None,
    date(2024, 1, 2),
    datetime(2024, 1, 2, 3, 4, 5),
]
_TALL_KEYS: list[Any] = ["a", "b c", 'q"k', 1, 2.5, True, None]


def _tall_part(rng: random.Random, depth: int) -> Any:
    """A short random value: leaves, short tuples, tables, lists and maps."""
    roll = rng.random()
    if depth > 2 or roll < 0.4:
        return rng.choice(_TALL_LEAVES)
    if roll < 0.5:
        table = Table(columns=[("ca", "string"), ("cb", "float")])
        table.add_row(["zwadm", 1.5])
        return table
    if roll < 0.6:
        return tuple(_tall_part(rng, depth + 1) for _ in range(rng.randint(1, 2)))
    if roll < 0.8:
        return [_tall_part(rng, depth + 1) for _ in range(rng.randint(0, 3))]
    return {key: _tall_part(rng, depth + 1) for key in rng.sample(_TALL_KEYS, rng.randint(0, 3))}


def _tall_secret(rng: random.Random) -> Any:
    """A list or map nested past the masking depth, with short random values beside each level."""
    value = _tall_part(rng, 0)
    for _ in range(MAX_DEPTH + rng.randint(1, 40)):
        siblings = [_tall_part(rng, 0) for _ in range(rng.randint(0, 2))]
        if rng.random() < 0.5:
            value = [*siblings[:1], value, *siblings[1:]]
        else:
            keys = rng.sample(_TALL_KEYS, len(siblings) + 1)
            value = {**dict(zip(keys[1:], siblings, strict=True)), keys[0]: value}
    return value
