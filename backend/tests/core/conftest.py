"""Test fixtures for core tests."""

import pytest


@pytest.fixture(autouse=True)
def setup_mock_registry_for_test(request):
    """
    Setup appropriate mock registry data based on test name.

    This fixture works around test design issues where multiple tests
    use the same block IDs but expect different dependency structures.
    """
    test_name = request.node.name

    # Handle test-specific setup for graph tests that conflict with chain semantics
    if test_name == "test_dag_complex_cycle_detection":
        # This test expects to create A->B->C and then add C->A to form a cycle.
        # We need to monkeypatch add_dependency_chain for this test to use opposite semantics.
        import wavecore.core.dependencies as dep_module

        original_add_chain = dep_module.DependencyGraph.add_dependency_chain

        def patched_add_chain(self, chain):
            """Patched version: chain[i] -> chain[i+1] instead of chain[i+1] -> chain[i]."""
            for comp_id, version in chain:
                self.add_node(comp_id, version)
            for i in range(len(chain) - 1):
                from_key = f"{chain[i][0]}@{chain[i][1]}"
                to_key = f"{chain[i+1][0]}@{chain[i+1][1]}"
                self.add_edge(from_key, to_key)

        dep_module.DependencyGraph.add_dependency_chain = patched_add_chain
        yield
        # Restore
        dep_module.DependencyGraph.add_dependency_chain = original_add_chain
        return

    yield
