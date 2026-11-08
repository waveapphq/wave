"""Data models grouped by domain.

Each submodule owns one slice of the model surface (blocks, controls,
entities, enums, plugins, workflow). Callers import
from the specific submodule they need - no barrel re-exports, no
implicit full-package load. Direct imports make the dependency graph
explicit and skip the fixed cost of importing every submodule when a
caller only needs one.
"""
