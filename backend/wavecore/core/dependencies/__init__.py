"""
Block dependency specification and resolution subpackage (REQ-3.1.2.3).

Re-exports all public names from the dependencies module for backward
compatibility. All imports of the form ``from wavecore.core.dependencies
import X`` continue to work unchanged.
"""

from wavecore.core.dependencies.dependencies import (
    SEMVER_RE,
    CircularDependencyError,
    CompatibilityValidator,
    ComponentRegistry,
    DependencyGraph,
    DependencyInjector,
    DependencyManager,
    DependencyResolutionError,
    DependencyResolver,
    ImpactAnalyzer,
    InterfaceCompatibilityError,
    SemanticVersion,
    UpgradeImpact,
    VersionResolver,
)

__all__ = [
    "SEMVER_RE",
    "CircularDependencyError",
    "CompatibilityValidator",
    "ComponentRegistry",
    "DependencyGraph",
    "DependencyInjector",
    "DependencyManager",
    "DependencyResolutionError",
    "DependencyResolver",
    "ImpactAnalyzer",
    "InterfaceCompatibilityError",
    "SemanticVersion",
    "UpgradeImpact",
    "VersionResolver",
]
