"""The /network/certificates endpoints (REQ-4.5.16).

    GET    /network/certificates                    -> CertificatesView
    PATCH  /network/certificates                    -> CertificatesView after the write
    POST   /network/certificates/parse              -> {certificates, errors}; writes nothing
    GET    /network/certificates/builtin            -> {certificates: CertificateRow[]}
    GET    /network/certificates/{certificate_id}   -> CertificateDetail

Success bodies are plain models (MCP settings style); failures ride the standard error envelope.
"""

import datetime
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import certifi
import pytest
import yaml
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.x509.oid import NameOID
from fastapi.testclient import TestClient
from httpx import Response

from tests.plugins.http.tls_material import Credential, make_credential
from wavecore.api.config import get_config
from wavecore.connectivity import trust_store

BASE = "/network/certificates"
SOURCE_KEY = "network.certificates.public_source"
UTC = datetime.UTC
NOT_BEFORE = datetime.datetime(2025, 7, 1, tzinfo=UTC)
NOT_AFTER = datetime.datetime(2036, 6, 30, 23, 59, 59, tzinfo=UTC)
BUILTIN_COUNT = (
    Path(certifi.where()).read_text(encoding="utf-8").count("-----BEGIN CERTIFICATE-----")
)
HOST_STORE_PATHS = (
    "/etc/ssl/certs/ca-certificates.crt, /etc/pki/tls/certs/ca-bundle.crt, "
    "/etc/ssl/ca-bundle.pem, /etc/pki/tls/cacert.pem, "
    "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem, /etc/ssl/cert.pem"
)
PRIVATE_KEY_MESSAGE = "The text contains a private key; paste certificates only"
CONTENT_TYPE_MESSAGE = "Send the text as JSON or the file as multipart/form-data"
PARSED_KEYS = {"id", "name", "type", "expires", "expired", "pem", "detail"}
ROW_KEYS = {"id", "name", "organization", "type", "expires"}


@dataclass(frozen=True)
class _Chain:
    root: Credential
    intermediate: Credential
    leaf: Credential


@pytest.fixture(scope="module")
def chain() -> _Chain:
    lab = [(NameOID.ORGANIZATION_NAME, "WAVE Lab")]
    root = make_credential(
        "WAVE Lab Root",
        key_kind="ec256",
        is_ca=True,
        extra_name_attrs=lab,
        not_before=NOT_BEFORE,
        not_after=NOT_AFTER,
    )
    intermediate = make_credential(
        "WAVE Lab Issuing CA",
        issuer=root,
        key_kind="ec256",
        is_ca=True,
        extra_name_attrs=lab,
        not_before=NOT_BEFORE,
        not_after=NOT_AFTER,
    )
    leaf = make_credential(
        "lab.example", issuer=intermediate, key_kind="ec256", not_after=NOT_AFTER
    )
    return _Chain(root, intermediate, leaf)


def _id(credential: Credential) -> str:
    return credential.cert.fingerprint(hashes.SHA256()).hex()


def _first_bundled() -> x509.Certificate:
    text = Path(certifi.where()).read_text(encoding="utf-8")
    start = text.index("-----BEGIN CERTIFICATE-----")
    end = text.index("-----END CERTIFICATE-----", start) + len("-----END CERTIFICATE-----")
    return x509.load_pem_x509_certificate(text[start:end].encode())


def _assert_error(response: Response, *, status_code: int, code: str, pattern: str) -> None:
    """Assert the WAVE error envelope with an anchored message pattern."""
    assert response.status_code == status_code, response.text
    body = response.json()
    assert body["success"] is False
    assert body["error"]["code"] == code
    assert re.match(pattern, body["error"]["message"]) is not None, body["error"]["message"]


def _exactly(message: str) -> str:
    return f"^{re.escape(message)}$"


def _config_source(config_on_disk: Callable[[], dict[str, Any]]) -> Any:
    """The public source as the config file holds it on disk right now."""
    return config_on_disk().get("network", {}).get("certificates", {}).get("public_source")


def _source_config(source: str) -> dict[str, Any]:
    return {"network": {"certificates": {"public_source": source}}}


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


@pytest.fixture
def store_file(temp_storage_path: Path) -> Path:
    return temp_storage_path / "network" / "certificates.yaml"


@pytest.fixture
def no_host_store(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(trust_store, "locate_host_store", lambda: None)


@pytest.fixture
def host_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, chain: _Chain) -> Path:
    path = tmp_path / "ca-bundle.crt"
    path.write_text(chain.root.cert_pem, encoding="utf-8")
    monkeypatch.setattr(trust_store, "locate_host_store", lambda: path)
    return path


@pytest.mark.usefixtures("no_host_store")
class TestGetView:
    def test_default_view(self, client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(certifi, "__version__", "2026.06.17")

        response = client.get(BASE)

        assert response.status_code == 200, response.text
        assert response.json() == {
            "settings": {
                "public_source": "builtin",
                "builtin": {"label": "June 2026", "count": BUILTIN_COUNT},
                "host_store": {"path": None, "count": 0, "last_changed": None},
            },
            "additional": [],
        }

    def test_the_host_store_summary(self, client: TestClient, host_store: Path) -> None:
        host_store_view = client.get(BASE).json()["settings"]["host_store"]

        assert host_store_view["path"] == str(host_store)
        assert host_store_view["count"] == 1
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", host_store_view["last_changed"]) is not None

    def test_an_unreadable_file_is_a_500(self, client: TestClient, store_file: Path) -> None:
        store_file.mkdir(parents=True)

        _assert_error(
            client.get(BASE),
            status_code=500,
            code="INTERNAL_ERROR",
            pattern=rf"^WAVE's additional certificates {re.escape(str(store_file))} "
            r"cannot be read: .+$",
        )


@pytest.mark.usefixtures("no_host_store")
class TestPatch:
    def test_additions_are_saved_and_returned(self, client: TestClient, chain: _Chain) -> None:
        response = client.patch(BASE, json={"add": [chain.root.cert_pem]})

        assert response.status_code == 200, response.text
        assert response.json()["additional"] == [
            {
                "id": _id(chain.root),
                "name": "WAVE Lab Root",
                "organization": "WAVE Lab",
                "type": "Root",
                "expires": "2036-06-30",
            }
        ]
        assert client.get(BASE).json() == response.json()

    def test_removals(self, client: TestClient, chain: _Chain) -> None:
        client.patch(BASE, json={"add": [chain.root.cert_pem, chain.intermediate.cert_pem]})

        response = client.patch(BASE, json={"remove": [_id(chain.root)]})

        assert response.status_code == 200, response.text
        assert [row["id"] for row in response.json()["additional"]] == [_id(chain.intermediate)]

    def test_an_empty_change_set_changes_nothing(self, client: TestClient, chain: _Chain) -> None:
        client.patch(BASE, json={"add": [chain.root.cert_pem]})
        before = client.get(BASE).json()

        response = client.patch(BASE, json={})

        assert response.status_code == 200, response.text
        assert response.json() == before

    def test_the_host_store_source(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, chain: _Chain
    ) -> None:
        bundle = tmp_path / "ca-bundle.crt"
        bundle.write_text(chain.root.cert_pem, encoding="utf-8")
        monkeypatch.setattr(trust_store, "locate_host_store", lambda: bundle)

        response = client.patch(BASE, json={"public_source": "host"})

        assert response.status_code == 200, response.text
        assert response.json()["settings"]["public_source"] == "host"

    def test_an_unknown_source(self, client: TestClient) -> None:
        _assert_error(
            client.patch(BASE, json={"public_source": "system"}),
            status_code=400,
            code="VALIDATION_ERROR",
            pattern=r"^Public certificate authorities must be 'builtin' or 'host'$",
        )

    def test_the_host_store_without_a_store(self, client: TestClient) -> None:
        _assert_error(
            client.patch(BASE, json={"public_source": "host"}),
            status_code=400,
            code="VALIDATION_ERROR",
            pattern=_exactly(
                f"No certificate store found on this WAVE host: looked in {HOST_STORE_PATHS}"
            ),
        )

    def test_an_addition_that_is_not_a_pem_certificate(self, client: TestClient) -> None:
        _assert_error(
            client.patch(BASE, json={"add": ["not a certificate"]}),
            status_code=400,
            code="VALIDATION_ERROR",
            pattern=r"^Addition 1: not a PEM certificate$",
        )

    def test_an_addition_that_is_not_a_ca_certificate(
        self, client: TestClient, chain: _Chain, store_file: Path
    ) -> None:
        response = client.patch(BASE, json={"add": [chain.root.cert_pem, chain.leaf.cert_pem]})

        _assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            pattern=r"^Addition 2: not a CA certificate$",
        )
        assert not store_file.exists()

    def test_an_unreadable_file_is_a_500(
        self, client: TestClient, chain: _Chain, store_file: Path
    ) -> None:
        store_file.mkdir(parents=True)

        _assert_error(
            client.patch(BASE, json={"add": [chain.root.cert_pem]}),
            status_code=500,
            code="INTERNAL_ERROR",
            pattern=rf"^WAVE's additional certificates {re.escape(str(store_file))} "
            r"cannot be read: .+$",
        )


class TestTwoStoreSave:
    """One Save: the source goes to the config file, the certificates to the data file."""

    @pytest.mark.usefixtures("no_host_store")
    def test_the_view_reads_the_source_from_the_config(
        self, client: TestClient, load_config: Callable[..., Any]
    ) -> None:
        load_config(_source_config("host"))

        response = client.get(BASE)

        assert response.status_code == 200, response.text
        assert response.json()["settings"]["public_source"] == "host"

    @pytest.mark.usefixtures("host_store")
    def test_the_source_is_saved_in_the_config_file(
        self,
        client: TestClient,
        store_file: Path,
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        response = client.patch(BASE, json={"public_source": "host"})

        assert response.status_code == 200, response.text
        assert response.json()["settings"]["public_source"] == "host"
        assert _config_source(config_on_disk) == "host"
        assert not store_file.exists()

    @pytest.mark.usefixtures("host_store")
    def test_source_and_additions_write_both_stores(
        self,
        client: TestClient,
        chain: _Chain,
        store_file: Path,
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        response = client.patch(BASE, json={"public_source": "host", "add": [chain.root.cert_pem]})

        assert response.status_code == 200, response.text
        assert _config_source(config_on_disk) == "host"
        stored = yaml.safe_load(store_file.read_text(encoding="utf-8"))
        assert set(stored) == {"certificates"}
        assert [entry["id"] for entry in stored["certificates"]] == [_id(chain.root)]
        assert client.get(BASE).json() == response.json()

    @pytest.mark.usefixtures("no_host_store")
    def test_additions_alone_leave_the_config_file_alone(
        self, client: TestClient, chain: _Chain, store_file: Path, config_file: Path
    ) -> None:
        before = config_file.read_bytes()

        response = client.patch(BASE, json={"add": [chain.root.cert_pem]})

        assert response.status_code == 200, response.text
        assert config_file.read_bytes() == before
        assert set(yaml.safe_load(store_file.read_text(encoding="utf-8"))) == {"certificates"}

    @pytest.mark.usefixtures("host_store")
    def test_the_saved_source_survives_a_restart(
        self,
        client: TestClient,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        client.patch(BASE, json={"public_source": "host"})
        assert _config_source(config_on_disk) == "host"

        load_config()

        assert client.get(BASE).json()["settings"]["public_source"] == "host"

    @pytest.mark.usefixtures("host_store")
    def test_a_read_only_config_is_a_500_and_nothing_is_written(
        self, client: TestClient, chain: _Chain, store_file: Path, read_only_config: Path
    ) -> None:
        before = read_only_config.read_bytes()

        response = client.patch(BASE, json={"public_source": "host", "add": [chain.root.cert_pem]})

        _assert_error(
            response,
            status_code=500,
            code="INTERNAL_ERROR",
            pattern=_exactly(
                f"Settings cannot be saved: the config file {read_only_config} is read-only"
            ),
        )
        assert read_only_config.read_bytes() == before
        assert not store_file.exists()
        view = client.get(BASE).json()
        assert view["settings"]["public_source"] == "builtin"
        assert view["additional"] == []

    @pytest.mark.usefixtures("no_host_store")
    def test_the_saved_source_sent_again_is_a_200_on_a_read_only_config(
        self,
        client: TestClient,
        store_file: Path,
        load_config: Callable[..., Any],
        read_only_config: Path,
    ) -> None:
        load_config(_source_config("builtin"))
        before = read_only_config.read_bytes()

        response = client.patch(BASE, json={"public_source": "builtin"})

        assert response.status_code == 200, response.text
        assert response.json()["settings"]["public_source"] == "builtin"
        assert read_only_config.read_bytes() == before
        assert not store_file.exists()

    @pytest.mark.usefixtures("host_store")
    def test_additions_with_the_saved_source_are_a_200_on_a_read_only_config(
        self,
        client: TestClient,
        chain: _Chain,
        store_file: Path,
        load_config: Callable[..., Any],
        read_only_config: Path,
    ) -> None:
        load_config(_source_config("host"))
        before = read_only_config.read_bytes()

        response = client.patch(BASE, json={"public_source": "host", "add": [chain.root.cert_pem]})

        assert response.status_code == 200, response.text
        assert read_only_config.read_bytes() == before
        assert response.json()["settings"]["public_source"] == "host"
        assert [row["id"] for row in response.json()["additional"]] == [_id(chain.root)]
        assert set(yaml.safe_load(store_file.read_text(encoding="utf-8"))) == {"certificates"}

    @pytest.mark.usefixtures("host_store")
    @pytest.mark.parametrize("with_addition", [False, True], ids=["source-only", "with-addition"])
    def test_an_unreadable_data_file_is_a_500_and_keeps_the_saved_source(
        self,
        client: TestClient,
        chain: _Chain,
        store_file: Path,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
        with_addition: bool,
    ) -> None:
        load_config(_source_config("builtin"))
        store_file.mkdir(parents=True)
        additions = [chain.root.cert_pem] if with_addition else []

        response = client.patch(BASE, json={"public_source": "host", "add": additions})

        _assert_error(
            response,
            status_code=500,
            code="INTERNAL_ERROR",
            pattern=rf"^WAVE's additional certificates {re.escape(str(store_file))} "
            r"cannot be read: .+$",
        )
        assert _config_source(config_on_disk) == "builtin"
        assert get_config().get(SOURCE_KEY) == "builtin"


class TestParse:
    def test_json_text(self, client: TestClient, chain: _Chain, store_file: Path) -> None:
        text = chain.root.cert_pem + chain.intermediate.cert_pem

        response = client.post(f"{BASE}/parse", json={"text": text})

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["errors"] == []
        assert [item["id"] for item in body["certificates"]] == [
            _id(chain.root),
            _id(chain.intermediate),
        ]
        assert all(set(item) == PARSED_KEYS for item in body["certificates"])
        assert body["certificates"][0]["expired"] is False
        assert body["certificates"][0]["detail"]["id"] == _id(chain.root)
        assert not store_file.exists()

    def test_json_text_errors(self, client: TestClient, chain: _Chain) -> None:
        response = client.post(
            f"{BASE}/parse", json={"text": chain.root.cert_pem + chain.root.key_pem}
        )

        assert response.status_code == 200, response.text
        assert response.json() == {
            "certificates": [],
            "errors": [{"index": None, "message": PRIVATE_KEY_MESSAGE}],
        }

    def test_a_multipart_pem_file(self, client: TestClient, chain: _Chain) -> None:
        data = (chain.root.cert_pem + chain.intermediate.cert_pem).encode()

        response = client.post(
            f"{BASE}/parse", files={"file": ("chain.pem", data, "application/x-pem-file")}
        )

        assert response.status_code == 200, response.text
        assert [item["pem"] for item in response.json()["certificates"]] == [
            chain.root.cert_pem,
            chain.intermediate.cert_pem,
        ]

    def test_a_multipart_der_file(self, client: TestClient, chain: _Chain) -> None:
        response = client.post(
            f"{BASE}/parse",
            files={"file": ("root.cer", chain.root.der, "application/pkix-cert")},
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["errors"] == []
        assert [item["pem"] for item in body["certificates"]] == [chain.root.cert_pem]

    def test_a_multipart_file_that_is_not_a_certificate(self, client: TestClient) -> None:
        response = client.post(
            f"{BASE}/parse",
            files={"file": ("leaf.bin", b"\x00\x01 junk", "application/octet-stream")},
        )

        assert response.status_code == 200, response.text
        assert response.json() == {
            "certificates": [],
            "errors": [{"index": None, "message": "leaf.bin is not a PEM or DER certificate file"}],
        }

    @pytest.mark.parametrize(
        "content_type", ["text/plain", "application/x-www-form-urlencoded", "application/xml"]
    )
    def test_another_content_type_is_refused(
        self, client: TestClient, chain: _Chain, content_type: str
    ) -> None:
        response = client.post(
            f"{BASE}/parse",
            content=chain.root.cert_pem.encode(),
            headers={"Content-Type": content_type},
        )

        _assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            pattern=_exactly(CONTENT_TYPE_MESSAGE),
        )


class TestBuiltin:
    def test_the_builtin_list(self, client: TestClient) -> None:
        response = client.get(f"{BASE}/builtin")

        assert response.status_code == 200, response.text
        rows = response.json()["certificates"]
        assert len(rows) == BUILTIN_COUNT
        assert all(set(row) == ROW_KEYS for row in rows)


@pytest.mark.usefixtures("no_host_store")
class TestDetail:
    def test_a_saved_additional_certificate(self, client: TestClient, chain: _Chain) -> None:
        client.patch(BASE, json={"add": [chain.intermediate.cert_pem]})

        response = client.get(f"{BASE}/{_id(chain.intermediate)}")

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["id"] == _id(chain.intermediate)
        assert body["name"] == "WAVE Lab Issuing CA"
        assert body["type"] == "Intermediate"
        assert body["pem"] == chain.intermediate.cert_pem

    def test_a_builtin_certificate(self, client: TestClient) -> None:
        bundled = _first_bundled()
        certificate_id = bundled.fingerprint(hashes.SHA256()).hex()

        response = client.get(f"{BASE}/{certificate_id}")

        assert response.status_code == 200, response.text
        assert response.json()["id"] == certificate_id
        assert response.json()["type"] == "Root"

    def test_an_unknown_id(self, client: TestClient) -> None:
        _assert_error(
            client.get(f"{BASE}/x"),
            status_code=404,
            code="NOT_FOUND",
            pattern=r"^Certificate with ID 'x' not found$",
        )


class TestStaticRoutes:
    def test_builtin_is_not_read_as_a_certificate_id(self, client: TestClient) -> None:
        response = client.get(f"{BASE}/builtin")

        assert response.status_code == 200, response.text
        assert "certificates" in response.json()

    def test_parse_is_not_read_as_a_certificate_id(self, client: TestClient) -> None:
        response = client.post(f"{BASE}/parse", json={"text": ""})

        assert response.status_code == 200, response.text
        assert response.json() == {"certificates": [], "errors": []}


def _absent_endpoint_calls(chain: _Chain) -> dict[str, tuple[str, str, dict[str, Any] | None]]:
    root_id = _id(chain.root)
    return {
        "put-settings": ("PUT", f"{BASE}/settings", {"public_source": "builtin"}),
        "post-additional": (
            "POST",
            f"{BASE}/additional",
            {"pem": chain.intermediate.cert_pem},
        ),
        "delete-one": ("DELETE", f"{BASE}/additional/{root_id}", None),
        "delete-batch": ("DELETE", f"{BASE}/additional/batch", {"ids": [root_id]}),
    }


@pytest.mark.usefixtures("no_host_store")
class TestAbsentEndpoints:
    @pytest.mark.parametrize(
        "name", ["put-settings", "post-additional", "delete-one", "delete-batch"]
    )
    def test_the_endpoint_does_not_exist(
        self, client: TestClient, chain: _Chain, name: str
    ) -> None:
        client.patch(BASE, json={"add": [chain.root.cert_pem]})
        before = client.get(BASE).json()
        method, path, body = _absent_endpoint_calls(chain)[name]

        response = client.request(method, path, json=body)

        assert response.status_code in (404, 405), response.text
        assert client.get(BASE).json() == before


class TestParseBodyChecks:
    def test_json_text_that_is_not_a_string(self, client: TestClient) -> None:
        response = client.post(f"{BASE}/parse", json={"text": 1})

        assert response.status_code == 400, response.text
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"

    def test_multipart_without_a_file_field(self, client: TestClient, chain: _Chain) -> None:
        response = client.post(
            f"{BASE}/parse",
            files={"other": ("root.pem", chain.root.cert_pem.encode(), "application/x-pem-file")},
        )

        assert response.status_code == 400, response.text
        assert response.json()["error"] == {
            "message": "Validation error for 'file': Field required",
            "code": "VALIDATION_ERROR",
        }
