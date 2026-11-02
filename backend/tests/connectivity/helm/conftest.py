"""Fixtures the Helm runner and verb tests share."""

import importlib
from typing import Any

import pytest

from tests.connectivity.helm._helm_fixtures import WAVE_ADDITIONAL, WAVE_ANCHORS, WaveTrust


@pytest.fixture
def wave_trust(monkeypatch: pytest.MonkeyPatch) -> WaveTrust:
    """WAVE's trust set with anchors the test names; each anchors_pem call is recorded."""
    trust_store = importlib.import_module("wavecore.connectivity.trust_store")
    trust = WaveTrust(
        spec=trust_store.TrustSpec(
            source="builtin",
            additional_pem=WAVE_ADDITIONAL,
            additional_count=1,
            builtin_label="June 2026",
        ),
        pem=WAVE_ANCHORS,
    )

    def anchors(spec: Any, *_args: Any, **_kwargs: Any) -> str:
        trust.calls.append(spec)
        return trust.pem

    monkeypatch.setattr(trust_store, "active_spec", lambda: trust.spec)
    monkeypatch.setattr(trust_store, "anchors_pem", anchors)
    return trust
