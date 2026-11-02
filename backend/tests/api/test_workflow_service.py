"""Unit tests for workflow_service layer (REQ-5.2.4.3).

This module tests the workflow service layer which provides workflow validation
operations including cycle detection, reachability analysis, and structural
verification. No start/end node requirements - startNode is injected at
render time by the FE and leaf nodes are natural endpoints.
"""

import uuid

from wavecore.api.services import workflow_service


class TestValidateWorkflow:
    """Test suite for validate_workflow service function."""

    def test_validate_workflow_returns_valid_for_simple_workflow(self) -> None:
        """Test that a simple valid workflow passes validation."""
        workflow = {
            "nodes": [
                {"id": "node1", "type": "workflowNode"},
                {"id": "node2", "type": "workflowNode"},
            ],
            "edges": [{"source": "node1", "target": "node2"}],
        }

        result = workflow_service.validate_workflow(workflow)

        assert result["valid"] is True
        assert len(result["errors"]) == 0

    def test_validate_workflow_returns_valid_for_complex_workflow(self) -> None:
        """Test that a complex valid workflow passes validation."""
        workflow = {
            "nodes": [
                {"id": "node1", "type": "workflowNode"},
                {"id": "block1", "type": "block", "block_ref": str(uuid.uuid4())},
                {"id": "block2", "type": "block", "block_ref": str(uuid.uuid4())},
                {"id": "node4", "type": "workflowNode"},
            ],
            "edges": [
                {"source": "node1", "target": "block1"},
                {"source": "block1", "target": "block2"},
                {"source": "block2", "target": "node4"},
            ],
        }

        result = workflow_service.validate_workflow(workflow)

        assert result["valid"] is True
        assert len(result["errors"]) == 0

    def test_validate_workflow_rejects_empty_nodes(self) -> None:
        """Test that empty workflow is rejected."""
        workflow = {"nodes": [], "edges": []}

        result = workflow_service.validate_workflow(workflow)

        assert result["valid"] is False
        assert result["errors"] == ["Workflow must have at least one block"]

    def test_validate_workflow_single_node_is_valid(self) -> None:
        """Test that a single node workflow is valid (leaf nodes are natural endpoints)."""
        workflow = {
            "nodes": [{"id": "only", "type": "workflowNode"}],
            "edges": [],
        }

        result = workflow_service.validate_workflow(workflow)

        assert result["valid"] is True

    def test_validate_workflow_detects_simple_cycle(self) -> None:
        """Test that simple cycle is detected."""
        workflow = {
            "nodes": [
                {"id": "first", "type": "workflowNode"},
                {"id": "a", "type": "block"},
                {"id": "b", "type": "block"},
            ],
            "edges": [
                {"source": "first", "target": "a"},
                {"source": "a", "target": "b"},
                {"source": "b", "target": "a"},  # Cycle back to a
            ],
        }

        result = workflow_service.validate_workflow(workflow)

        assert result["valid"] is False
        assert any("cycle" in e.lower() for e in result["errors"])

    def test_validate_workflow_detects_self_loop(self) -> None:
        """Test that self-loop cycle is detected."""
        workflow = {
            "nodes": [
                {"id": "first", "type": "workflowNode"},
                {"id": "loop", "type": "block"},
            ],
            "edges": [
                {"source": "first", "target": "loop"},
                {"source": "loop", "target": "loop"},  # Self loop
            ],
        }

        result = workflow_service.validate_workflow(workflow)

        assert result["valid"] is False
        assert any("cycle" in e.lower() for e in result["errors"])

    def test_validate_workflow_detects_unreachable_nodes(self) -> None:
        """Test that unreachable nodes are detected."""
        workflow = {
            "nodes": [
                {"id": "first", "type": "workflowNode"},
                {"id": "orphan", "type": "block"},
                {"id": "connected", "type": "workflowNode"},
            ],
            "edges": [{"source": "first", "target": "connected"}],
        }

        result = workflow_service.validate_workflow(workflow)

        assert result["valid"] is False
        assert any("unreachable" in e.lower() for e in result["errors"])

    def test_validate_workflow_names_an_unreachable_block(self) -> None:
        workflow = {
            "nodes": [
                {"id": "first", "type": "workflowNode"},
                {"id": "orphan", "type": "workflowNode"},
            ],
            "edges": [],
        }

        result = workflow_service.validate_workflow(workflow)

        assert result["errors"] == ["Block 'orphan' is unreachable from first block"]

    def test_validate_workflow_handles_parallel_paths(self) -> None:
        """Test that parallel paths are handled correctly."""
        workflow = {
            "nodes": [
                {"id": "first", "type": "workflowNode"},
                {"id": "branch1", "type": "block"},
                {"id": "branch2", "type": "block"},
                {"id": "merge", "type": "workflowNode"},
            ],
            "edges": [
                {"source": "first", "target": "branch1"},
                {"source": "first", "target": "branch2"},
                {"source": "branch1", "target": "merge"},
                {"source": "branch2", "target": "merge"},
            ],
        }

        result = workflow_service.validate_workflow(workflow)

        assert result["valid"] is True

    def test_validate_workflow_returns_warnings_for_dead_ends(self) -> None:
        """Test that dead end nodes generate warnings (but not errors)."""
        workflow = {
            "nodes": [
                {"id": "first", "type": "workflowNode"},
                {"id": "block", "type": "block"},
                {"id": "other", "type": "workflowNode"},
            ],
            "edges": [
                {"source": "first", "target": "block"},
                {"source": "first", "target": "other"},
                # block and other are reachable but have no outgoing edges
            ],
        }

        result = workflow_service.validate_workflow(workflow)

        # Dead ends are just warnings now - leaf nodes are natural endpoints
        assert result["valid"] is True
        assert any("dead end" in w.lower() for w in result["warnings"])

    def test_validate_workflow_names_a_dead_end_block(self) -> None:
        workflow = {"nodes": [{"id": "only", "type": "workflowNode"}], "edges": []}

        result = workflow_service.validate_workflow(workflow)

        assert result["warnings"] == ["Block 'only' has no outgoing edges (dead end)"]

    def test_validate_workflow_handles_empty_block_refs(self) -> None:
        """Test that empty block references are handled (no validation error)."""
        workflow = {
            "nodes": [
                {"id": "first", "type": "workflowNode"},
                {"id": "block", "type": "block", "block_ref": ""},
                {"id": "last", "type": "workflowNode"},
            ],
            "edges": [
                {"source": "first", "target": "block"},
                {"source": "block", "target": "last"},
            ],
        }

        result = workflow_service.validate_workflow(workflow)

        assert result["valid"] is True

    def test_validate_workflow_accepts_valid_block_references(self) -> None:
        """Test that valid block references pass validation."""
        workflow = {
            "nodes": [
                {"id": "first", "type": "workflowNode"},
                {"id": "block", "type": "block", "block_ref": str(uuid.uuid4())},
                {"id": "last", "type": "workflowNode"},
            ],
            "edges": [
                {"source": "first", "target": "block"},
                {"source": "block", "target": "last"},
            ],
        }

        result = workflow_service.validate_workflow(workflow)

        assert result["valid"] is True

    def test_validate_workflow_complex_cycle_detection(self) -> None:
        """Test cycle detection in complex graph."""
        workflow = {
            "nodes": [
                {"id": "first", "type": "workflowNode"},
                {"id": "a", "type": "block"},
                {"id": "b", "type": "block"},
                {"id": "c", "type": "block"},
                {"id": "d", "type": "block"},
            ],
            "edges": [
                {"source": "first", "target": "a"},
                {"source": "a", "target": "b"},
                {"source": "b", "target": "c"},
                {"source": "c", "target": "d"},
                {"source": "d", "target": "b"},  # Cycle: b -> c -> d -> b
            ],
        }

        result = workflow_service.validate_workflow(workflow)

        assert result["valid"] is False
        assert any("cycle" in e.lower() for e in result["errors"])

    def test_validate_workflow_ignores_invalid_edge_targets(self) -> None:
        """Test that edges to non-existent nodes are handled gracefully."""
        workflow = {
            "nodes": [
                {"id": "first", "type": "workflowNode"},
                {"id": "second", "type": "workflowNode"},
            ],
            "edges": [
                {"source": "first", "target": "second"},
                {"source": "first", "target": "nonexistent"},  # Invalid target
            ],
        }

        result = workflow_service.validate_workflow(workflow)

        # Should still be valid - invalid edges are ignored
        assert result["valid"] is True

    def test_validate_workflow_block_with_block_id(self) -> None:
        """Test that block_id is also accepted as block reference."""
        workflow = {
            "nodes": [
                {"id": "first", "type": "workflowNode"},
                {"id": "block", "type": "block", "block_id": str(uuid.uuid4())},
                {"id": "last", "type": "workflowNode"},
            ],
            "edges": [
                {"source": "first", "target": "block"},
                {"source": "block", "target": "last"},
            ],
        }

        result = workflow_service.validate_workflow(workflow)

        assert result["valid"] is True

    def test_validate_workflow_rejects_invalid_block_ref_type(self) -> None:
        """Test that non-string block reference is rejected."""
        workflow = {
            "nodes": [
                {"id": "first", "type": "workflowNode"},
                {"id": "block", "type": "block", "block_ref": 12345},  # Invalid type
                {"id": "last", "type": "workflowNode"},
            ],
            "edges": [
                {"source": "first", "target": "block"},
                {"source": "block", "target": "last"},
            ],
        }

        result = workflow_service.validate_workflow(workflow)

        assert result["valid"] is False
        assert any("invalid block reference" in e.lower() for e in result["errors"])

    def test_validate_workflow_names_the_block_with_an_invalid_block_reference(self) -> None:
        workflow = {"nodes": [{"id": "only", "type": "block", "block_ref": 12345}], "edges": []}

        result = workflow_service.validate_workflow(workflow)

        assert result["errors"] == ["Block 'only' has invalid block reference"]

    def test_validate_workflow_detects_cycle_in_disconnected_component(self) -> None:
        """Test cycle detection in a disconnected graph component."""
        workflow = {
            "nodes": [
                {"id": "first", "type": "workflowNode"},
                {"id": "c1", "type": "block"},
                {"id": "c2", "type": "block"},
            ],
            "edges": [
                {"source": "c1", "target": "c2"},
                {"source": "c2", "target": "c1"},  # Cycle in disconnected component
            ],
        }

        result = workflow_service.validate_workflow(workflow)

        assert result["valid"] is False
        assert any("cycle" in e.lower() for e in result["errors"])
