"""
Test helper functions for creating test instances with mock registry.

This module provides convenience functions to create production instances
with test registries injected, avoiding repetitive setup in every test.
"""

from wavecore.core.dependencies import (
    DependencyInjector,
    DependencyManager,
    DependencyResolver,
    ImpactAnalyzer,
)

from .test_registry import MockComponentRegistry


def create_test_resolver(registry_data=None, strategy="highest"):
    """Create DependencyResolver with mock registry for testing."""
    registry = MockComponentRegistry(registry_data)
    return DependencyResolver(registry, default_strategy=strategy)


def create_test_injector(registry_data=None):
    """Create DependencyInjector with mock registry for testing."""
    registry = MockComponentRegistry(registry_data)
    return DependencyInjector(registry)


def create_test_impact_analyzer(registry_data=None):
    """Create ImpactAnalyzer with mock registry for testing."""
    registry = MockComponentRegistry(registry_data)
    return ImpactAnalyzer(registry)


def create_test_manager(registry_data=None):
    """Create DependencyManager with mock registry for testing."""
    registry = MockComponentRegistry(registry_data)
    return DependencyManager(registry)
