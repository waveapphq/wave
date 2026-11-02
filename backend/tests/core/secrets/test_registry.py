"""
SecretRegistry contract tests (REQ-3.1.3.5, REQ-4.5.3).

The per-run registry holds two things: the set of variable NAMES flagged
secret for the run (flag-based structural masking), and the set of string
forms of registered secret VALUES (text scrubbing). It is flat per-run
state - no scopes, no reveal, no source-store back ends.
"""

from decimal import Decimal

from wavecore.core.secrets.masking import mask_text
from wavecore.core.secrets.registry import SecretRegistry
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
