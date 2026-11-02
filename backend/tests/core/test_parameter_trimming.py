"""Tests for strict single-line parameter input trimming (REQ-3.4.2.2).

A parameter flagged for trimming has leading and trailing whitespace stripped
from its resolved value. Trimming runs after literal/expression/template
resolution, so a stray newline - typed into the value editor or produced by an
expression - cannot reach a URL, path, mode, encoding, or enum selection.
Unflagged free-form payloads (body, content) preserve their value verbatim.
"""

from wavecore.core.execution.plugin_executor import (
    _resolve_single_parameter,
    resolve_parameters,
)


class TestResolveParametersTrimFields:
    """resolve_parameters strips a flagged param's resolved string value."""

    def test_flagged_literal_trailing_whitespace_trimmed(self):
        """A flagged literal loses its trailing space and newline."""
        result = resolve_parameters(
            parameters={"url": "https://example.com \n"},
            expression_fields=set(),
            variables={},
            parameter_types={"url": "string"},
            trim_fields={"url"},
        )
        assert result["url"] == "https://example.com"

    def test_flagged_literal_leading_whitespace_trimmed(self):
        """A flagged literal loses leading whitespace."""
        result = resolve_parameters(
            parameters={"path": "  /etc/hosts"},
            expression_fields=set(),
            variables={},
            parameter_types={"path": "string"},
            trim_fields={"path"},
        )
        assert result["path"] == "/etc/hosts"

    def test_flagged_internal_whitespace_preserved(self):
        """Only the edges are stripped; internal whitespace survives."""
        result = resolve_parameters(
            parameters={"path": "\t/my data/file \n"},
            expression_fields=set(),
            variables={},
            parameter_types={"path": "string"},
            trim_fields={"path"},
        )
        assert result["path"] == "/my data/file"

    def test_flagged_expression_result_trimmed(self):
        """An expression result is trimmed (the FE never sees the runtime value)."""
        result = resolve_parameters(
            parameters={"url": "raw"},
            expression_fields={"url"},
            variables={"raw": "http://x\n"},
            parameter_types={"url": "string"},
            trim_fields={"url"},
        )
        assert result["url"] == "http://x"

    def test_flagged_template_result_trimmed(self):
        """A rendered template result is trimmed."""
        result = resolve_parameters(
            parameters={"url": "{{base}}\n"},
            expression_fields=set(),
            variables={"base": "http://x"},
            parameter_types={"url": "string"},
            template_fields={"url"},
            trim_fields={"url"},
        )
        assert result["url"] == "http://x"

    def test_unflagged_freeform_value_preserved(self):
        """A param NOT in trim_fields keeps its surrounding whitespace verbatim."""
        result = resolve_parameters(
            parameters={"url": "http://x", "body": "line1\nline2\n"},
            expression_fields=set(),
            variables={},
            parameter_types={"url": "string", "body": "string"},
            trim_fields={"url"},
        )
        assert result["body"] == "line1\nline2\n"

    def test_trim_fields_none_does_not_trim(self):
        """trim_fields=None leaves every value exactly as provided."""
        result = resolve_parameters(
            parameters={"url": "https://x \n"},
            expression_fields=set(),
            variables={},
            parameter_types={"url": "string"},
            trim_fields=None,
        )
        assert result["url"] == "https://x \n"

    def test_non_string_flagged_value_untouched(self):
        """A flagged param whose value is not a string passes through unchanged."""
        result = resolve_parameters(
            parameters={"timeout": 30},
            expression_fields=set(),
            variables={},
            parameter_types={"timeout": "integer"},
            trim_fields={"timeout"},
        )
        assert result["timeout"] == 30

    def test_flagged_enum_value_trailing_newline_trimmed(self):
        """An enum selection with a stray newline trims so it matches the allowed set."""
        result = resolve_parameters(
            parameters={"method": "POST\n"},
            expression_fields=set(),
            variables={},
            parameter_types={"method": "string"},
            trim_fields={"method"},
        )
        assert result["method"] == "POST"

    def test_flagged_whitespace_only_value_becomes_empty(self):
        """A flagged whitespace-only value strips to an empty string."""
        result = resolve_parameters(
            parameters={"url": "   "},
            expression_fields=set(),
            variables={},
            parameter_types={"url": "string"},
            trim_fields={"url"},
        )
        assert result["url"] == ""

    def test_flagged_param_absent_from_parameters(self):
        """A trim_fields entry with no matching parameter does not error."""
        result = resolve_parameters(
            parameters={"other": "x"},
            expression_fields=set(),
            variables={},
            parameter_types={"other": "string"},
            trim_fields={"url"},
        )
        assert result == {"other": "x"}

    def test_multiple_params_only_flagged_are_trimmed(self):
        """In a mixed set, only the flagged params are stripped."""
        result = resolve_parameters(
            parameters={"url": "http://x \n", "body": "b\n"},
            expression_fields=set(),
            variables={},
            parameter_types={"url": "string", "body": "string"},
            trim_fields={"url"},
        )
        assert result == {"url": "http://x", "body": "b\n"}


class TestResolveSingleParameterTrim:
    """_resolve_single_parameter strips a flagged string (sibling to float down-coercion)."""

    def test_single_parameter_strips_flagged_string(self):
        """A flagged string value is stripped at the single-parameter edge."""
        result = _resolve_single_parameter(
            "url", "https://x \n", set(), set(), {}, {"url": "string"}, trim_fields={"url"}
        )
        assert result == "https://x"

    def test_single_parameter_unflagged_preserves_string(self):
        """An unflagged string value keeps its surrounding whitespace."""
        result = _resolve_single_parameter(
            "url", "https://x \n", set(), set(), {}, {"url": "string"}, trim_fields=set()
        )
        assert result == "https://x \n"

    def test_single_parameter_trims_template_result(self):
        """The trim applies after template rendering."""
        result = _resolve_single_parameter(
            "url",
            "{{base}}\n",
            set(),
            {"url"},
            {"base": "http://x"},
            {"url": "string"},
            trim_fields={"url"},
        )
        assert result == "http://x"
