"""The pinned OpenSearch API specification extract: query and aggregation vocabulary (OS-12)."""

import json
from dataclasses import dataclass
from functools import cache
from importlib import resources
from typing import Any

_EXTRACT_FILE = "api-spec-extract.json"
# WAVE's own one-line descriptions for the types the specification leaves undescribed.
_WAVE_DESCRIPTIONS_FILE = "wave-type-descriptions.json"
_FAMILIES = {"query_dsl": "queries", "aggregation": "aggregations"}


@dataclass(frozen=True)
class Param:
    """One parameter: its value kind, enum values in spec order, description and version added."""

    kind: str
    enum: tuple[str, ...]
    description: str
    version_added: str


class ApiSpec:
    """Answers which keys a JSON path allows and what each key takes."""

    def __init__(
        self, extract: dict[str, Any], wave_descriptions: dict[str, dict[str, str]]
    ) -> None:
        self.commit: str = extract["source"]["commit"]
        self.field_keyed_queries = frozenset(extract["field_keyed_queries"])
        self._types = {
            language: {
                name: {key: _param(entry) for key, entry in spec["params"].items()}
                for name, spec in extract[family].items()
            }
            for language, family in _FAMILIES.items()
        }
        # The specification's text wins; WAVE's fills a type it leaves undescribed.
        self._descriptions: dict[str, dict[str, str]] = {
            language: {
                name: spec.get("description") or wave_descriptions[family].get(name, "")
                for name, spec in extract[family].items()
            }
            for language, family in _FAMILIES.items()
        }

    def type_description(self, language: str, name: str) -> str:
        """What a query or aggregation type does; empty for a type the extract does not hold."""
        return self._descriptions[language].get(name, "")

    def keys_at(self, language: str, path: list[str]) -> list[str]:
        """The keys allowed at the path, sorted: types at the root, a type's parameters below."""
        return sorted(self._params(language, path) if path else self._types[language])

    def param(self, language: str, path: list[str], key: str) -> Param | None:
        """What the key takes at the path; None when the spec does not list it there."""
        return self._params(language, path).get(key)

    def _params(self, language: str, path: list[str]) -> dict[str, Param]:
        """A type's parameters; a field-keyed query takes them one level down, under the field."""
        params = self._types[language].get(path[0]) if path else None
        if params is None:
            return {}
        depth = 2 if language == "query_dsl" and path[0] in self.field_keyed_queries else 1
        return params if len(path) == depth else {}


def _param(entry: dict[str, Any]) -> Param:
    return Param(
        kind=entry["kind"],
        enum=tuple(entry.get("enum", ())),
        description=entry.get("description", ""),
        version_added=entry.get("version_added", ""),
    )


@cache
def load_extract() -> ApiSpec:
    """The packaged extract and WAVE's type descriptions, read once."""
    return ApiSpec(_packaged(_EXTRACT_FILE), _packaged(_WAVE_DESCRIPTIONS_FILE))


def _packaged(name: str) -> Any:
    return json.loads(resources.files(__package__).joinpath(name).read_text(encoding="utf-8"))
