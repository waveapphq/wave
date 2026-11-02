"""ETag header tests for Function endpoints.

Contract:
- GET /functions/{id} returns the ETag header.
- POST /functions returns the ETag header.

ETag is SHA-256 over canonical JSON; see test_functions_storage.py for
the low-level determinism guarantees. This file exercises the wire surface.
"""

import re

import pytest
from fastapi.testclient import TestClient

from .conftest import make_function_payload


class TestEtagHeaderPresent:
    def test_get_returns_etag_header(self, client: TestClient) -> None:
        created = client.post("/functions", json=make_function_payload(name="etag_get")).json()
        fn_id = created["data"]["id"]
        response = client.get(f"/functions/{fn_id}")
        assert response.status_code == 200
        assert "ETag" in response.headers
        # SHA-256 hex; the route may or may not wrap it in quotes.
        bare = response.headers["ETag"].strip('"')
        assert re.fullmatch(r"[0-9a-f]{64}", bare)

    def test_post_returns_etag_header(self, client: TestClient) -> None:
        response = client.post("/functions", json=make_function_payload(name="etag_post"))
        assert response.status_code == 201
        assert "ETag" in response.headers


pytestmark = pytest.mark.usefixtures("temp_storage_path")
