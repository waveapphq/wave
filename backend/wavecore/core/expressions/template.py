"""The {{expression}} template marker and the names a template reads (REQ-3.1.3.13).

Single braces {} are not markers (safe for JSON, YAML, XML).
"""

import re

# Matches {{...}} but NOT single braces {..}
_TEMPLATE_PATTERN = re.compile(r"\{\{(.+?)\}\}")


def template_expressions(template: str) -> list[str]:
    """The expression inside each ``{{ }}`` marker of a template, blank markers left out."""
    pieces = (match.group(1).strip() for match in _TEMPLATE_PATTERN.finditer(template))
    return [piece for piece in pieces if piece]


def extract_template_names(template: str) -> set[str]:
    """Variable names referenced inside a template's ``{{ }}`` markers, so a
    template is reference-checked exactly like an expression (REQ-3.1.3.15)."""
    from wavecore.core.variables.computed import extract_expression_names

    names: set[str] = set()
    for expression in template_expressions(template):
        names.update(extract_expression_names(expression))
    return names
