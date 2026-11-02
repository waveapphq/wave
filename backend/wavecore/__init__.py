"""
wavecore - WAVE (Workflow Automation and Validation Engine) Core Package

A comprehensive dual-interface automation and testing framework for distributed systems,
with strong support for Kubernetes environments and event processing pipelines.
"""

from pathlib import Path

__version__ = next(
    line.split("=", 1)[1].strip()
    for line in Path(__file__)
    .resolve()
    .parent.parent.parent.joinpath("VERSION")
    .read_text(encoding="utf-8")
    .splitlines()
    if line.strip().startswith("ver=")
)
__all__ = ["__version__"]
