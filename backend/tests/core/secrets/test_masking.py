"""
Masking function contract tests (REQ-3.1.3.5, REQ-4.5.3).

Two masking mechanisms share one canonical placeholder:
- mask_text: value-scrub of registered secret byte-forms inside outbound text
- mask_structure / structural_mask: flag-based full-opacity masking of
  variable displays (a secret shows as the bare placeholder - no keys,
  no shape, no counts)

There is no reveal, config or filter surface.
"""

from decimal import Decimal
from typing import Any

import pytest

import wavecore.core.secrets.masking as masking_module
from wavecore.core.secrets.masking import (
    MASK_PLACEHOLDER,
    mask_structure,
    mask_text,
    mask_with_metadata,
    structural_mask,
)
from wavecore.core.secrets.registry import SecretRegistry


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

    def test_content_scrub_depth_cap_leaves_ultradeep_values_raw(self) -> None:
        # Recursion guard, not a masking contract: beyond the depth cap the
        # remaining content passes through unscrubbed instead of overflowing.
        registry = self._registry()
        deep: object = "s3cr3t-t0ken-99"
        for _ in range(120):
            deep = [deep]

        masked = mask_structure({"payload": deep}, registry)

        node = masked["payload"]
        for _ in range(120):
            node = node[0]
        assert node == "s3cr3t-t0ken-99"


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
