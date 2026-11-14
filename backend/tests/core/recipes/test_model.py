"""Recipe control field table: each control step's recipe keys and the stored fields they write.

REQ-5.2.7.3. The table is read through its two lookups, forward (compile, stage 1) and
inverse (readback); every control field the catalog declares has a recipe key or is
structural, so a new control field with no recipe form fails here.
"""

from typing import Any

import pytest

from wavecore.core.recipes import model

# The step keyword each catalog control is written with.
CONTROL_KEYWORDS: dict[str, str] = {
    "if-else": "if",
    "switch-case": "switch",
    "for": "for",
    "for-each": "for_each",
    "while": "while",
    "try-catch-finally": "try",
    "parallel": "parallel",
    "assert": "assert",
    "wait-until": "wait_until",
    "variable-setter": "set",
    "delay": "delay",
    "halt": "halt",
    "break": "break",
    "continue": "continue",
    "note": "note",
}

# Stored fields no recipe key writes: the recipe shape carries them.
STRUCTURAL_FIELDS: dict[str, frozenset[str]] = {
    "if": frozenset({"branches"}),
    "switch": frozenset({"branches"}),
    "for": frozenset({"mode"}),
    "for_each": frozenset(),
    "while": frozenset({"conditions"}),
    "try": frozenset({"enable_catch", "enable_finally"}),
    "parallel": frozenset({"branches"}),
    "assert": frozenset({"assertions"}),
    "wait_until": frozenset({"conditions", "mode"}),
    "set": frozenset({"variables"}),
    "delay": frozenset(),
    "halt": frozenset(),
    "break": frozenset({"target_loop"}),
    "continue": frozenset({"target_loop"}),
    "note": frozenset(),
}

# One recipe mapping per form, holding only the keys the table maps to a stored field.
VALUE_SAMPLES: dict[str, list[dict[str, Any]]] = {
    "if": [{}],
    "switch": [{}],
    "for": [
        {"count": 6, "step": 2, "timeout": 1.5},
        {"range": {"start": 0, "end": 10, "step": 2}, "timeout": 1.5},
    ],
    "for_each": [{"collection": [1, 2], "collection_type": "array", "timeout": 2.5}],
    "while": [{"mode": "do-while", "max_iterations": 5, "timeout": 3.5}],
    "try": [{}],
    "parallel": [{"join": "first", "time_limit": 5000}],
    "assert": [{"fail_current_scope": True, "mode": "split"}],
    "wait_until": [
        {"timeout": 30000, "interval": 250, "message": "gave up", "fail_current_scope": True}
    ],
    "set": [{}],
    "delay": [{"duration": 500}],
    "halt": [{"scope": "suite", "message": "stop here", "status": "passed"}],
    "break": [{}],
    "continue": [{}],
    "note": [{"text": "Check the pods", "color": "green"}],
}


def _catalog_fields() -> dict[str, frozenset[str]]:
    from wavecore.core.recipes.validator import load_block_catalog

    return {
        block_id: frozenset(entry.parameters)
        for block_id, entry in load_block_catalog().items()
        if entry.kind == "control"
    }


def _mapped_fields(keyword: str) -> frozenset[str]:
    """The stored fields the table's forward lookup writes for every form of a keyword."""
    written: set[str] = set()
    for sample in VALUE_SAMPLES[keyword]:
        written.update(model.recipe_fields(keyword, sample))
    return frozenset(written)


class TestControlFieldTable:
    def test_every_catalog_control_has_a_step_keyword(self) -> None:
        assert set(_catalog_fields()) == set(CONTROL_KEYWORDS)

    @pytest.mark.parametrize(
        ("control_id", "keyword"), sorted(CONTROL_KEYWORDS.items()), ids=sorted(CONTROL_KEYWORDS)
    )
    def test_every_catalog_field_has_a_recipe_key_or_is_structural(
        self, control_id: str, keyword: str
    ) -> None:
        declared = _catalog_fields()[control_id]
        structural = STRUCTURAL_FIELDS[keyword]
        assert _mapped_fields(keyword) | structural == declared

    def test_the_wait_until_interval_writes_the_check_interval(self) -> None:
        stored = dict(model.recipe_fields("wait_until", {"interval": 250}))
        for field in STRUCTURAL_FIELDS["wait_until"]:
            stored.pop(field, None)
        assert stored == {"check_interval": 250}
        assert model.readback_keys("wait_until", {"check_interval": 250}) == {"interval": 250}

    @pytest.mark.parametrize(
        ("keyword", "sample"),
        [(keyword, sample) for keyword, samples in VALUE_SAMPLES.items() for sample in samples],
        ids=[
            f"{keyword}-{index}"
            for keyword, samples in VALUE_SAMPLES.items()
            for index in range(len(samples))
        ],
    )
    def test_forward_then_inverse_gives_back_the_same_keys(
        self, keyword: str, sample: dict[str, Any]
    ) -> None:
        stored = model.recipe_fields(keyword, sample)
        assert model.readback_keys(keyword, stored) == sample

    @pytest.mark.parametrize("keyword", sorted(set(VALUE_SAMPLES) & set(model.CONSTRUCT_KEYS)))
    def test_a_value_key_of_construct_keys_comes_from_the_table(self, keyword: str) -> None:
        table_keys: set[str] = set()
        for sample in VALUE_SAMPLES[keyword]:
            table_keys.update(model.readback_keys(keyword, model.recipe_fields(keyword, sample)))
        assert table_keys <= model.CONSTRUCT_KEYS[keyword]
