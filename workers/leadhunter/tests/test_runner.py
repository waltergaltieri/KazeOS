from __future__ import annotations

import json

import pytest

from leadhunter_worker import runner
from leadhunter_worker.extract import ProviderOutputRejected


def test_run_once_rejects_server_errors_before_reading_a_job(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(runner, "api", lambda *_args, **_kwargs: (500, {"error": "Job claim failed"}))

    with pytest.raises(RuntimeError, match="status 500"):
        runner.run_once("https://kazeos.example", "secret")


def test_run_once_returns_false_when_no_job_is_available(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(runner, "api", lambda *_args, **_kwargs: (204, None))

    assert runner.run_once("https://kazeos.example", "secret") is False


class FakeResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = json.dumps(payload).encode()
        self.status = 200
        self.headers = {"Content-Type": "application/json"}

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self, size: int) -> bytes:
        return self.payload[:size]


def test_discover_queries_searxng_and_normalizes_public_candidates() -> None:
    requested: list[str] = []

    def opener(request: object, timeout: int) -> FakeResponse:
        requested.append(request.full_url)  # type: ignore[attr-defined]
        assert timeout == 30
        return FakeResponse({"results": [{
            "url": "https://example.com/catalog/?utm_source=search#top",
            "title": "Example Mayorista",
            "content": "Venta mayorista",
            "engine": "brave",
        }]})

    result = runner.discover({
        "kind": "source_query",
        "id": "query:1",
        "source": "web_search",
        "country": "AR",
        "region": None,
        "industry": "mayoristas",
        "query": "mayoristas Argentina",
        "cursor": {"state": "initial"},
        "geographyEvidence": None,
    }, "http://searxng:8080/search", opener=opener)

    assert "q=mayoristas+Argentina" in requested[0]
    assert "format=json" in requested[0]
    assert result == {
        "kind": "discover",
        "output": {
            "candidateCount": 1,
            "candidates": [{
                "sourceType": "web_search",
                "sourceIdentity": "example.com",
                "sourceUrl": "https://example.com/catalog/?utm_source=search#top",
                "observedUrl": "https://example.com/catalog/?utm_source=search#top",
                "canonicalUrl": "https://example.com/catalog",
                "observedName": "Example Mayorista",
                "observedLocation": None,
                "providerRank": 1,
                "metadata": {
                    "engine": "brave",
                    "snippet": "Venta mayorista",
                    "snippetTrust": "untrusted",
                    "identity": {
                        "name": "Example Mayorista",
                        "emails": [],
                        "urls": [{"url": "https://example.com/catalog", "role": "official_website"}],
                        "location": {},
                        "organizationRole": "unknown",
                    },
                },
            }],
            "nextCursor": {"state": "next", "value": {"page": 2}},
        },
    }


def test_discover_normalizes_seed_url_without_calling_searxng() -> None:
    def unexpected(*_args: object, **_kwargs: object) -> FakeResponse:
        raise AssertionError("seed discovery must not call SearXNG")

    result = runner.discover({
        "kind": "seed_url",
        "id": "seed:1",
        "url": "https://example.com/?utm_campaign=seed",
    }, "http://searxng:8080/search", opener=unexpected)

    assert result["output"]["candidateCount"] == 1
    assert result["output"]["candidates"][0]["sourceType"] == "seed_url"
    assert result["output"]["candidates"][0]["canonicalUrl"] == "https://example.com/"
    assert result["output"]["nextCursor"] == {"state": "exhausted"}


def test_trigger_tick_uses_worker_auth_api(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str, str, dict[str, object]]] = []

    def fake_api(method: str, url: str, token: str, body: dict[str, object]) -> tuple[int, object]:
        calls.append((method, url, token, body))
        return 200, {"planned": {}, "identity": {}}

    monkeypatch.setattr(runner, "api", fake_api)
    runner.trigger_tick("https://kazeos.example/", "secret")

    assert calls == [(
        "POST",
        "https://kazeos.example/api/internal/leadhunter/tick",
        "secret",
        {},
    )]


def test_research_uses_minimax_when_the_subscription_key_is_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    expected = {"source_url": "https://example.com/", "findings": []}

    class FakeClient:
        def __init__(self, api_key: str, base_url: str, model: str) -> None:
            assert api_key == "subscription-key"
            assert base_url == "https://api.minimax.io/v1"
            assert model == "MiniMax-M3"

        def extract(self, _request: object) -> object:
            class Result:
                def model_dump(self, mode: str) -> dict[str, object]:
                    assert mode == "json"
                    return expected

            return Result()

    monkeypatch.setenv("MINIMAX_API_KEY", "subscription-key")
    monkeypatch.setenv("MINIMAX_BASE_URL", "https://api.minimax.io/v1")
    monkeypatch.setenv("MINIMAX_MODEL", "MiniMax-M3")
    monkeypatch.setattr(runner, "MiniMaxClient", FakeClient)

    result = runner.result_for({
        "kind": "research",
        "payload": {
            "source": {
                "sourceUrl": "https://example.com/",
                "sourceType": "official_site",
                "suppliedAt": "2026-10-02T12:00:00Z",
                "contentSha256": "0" * 64,
            },
            "content": "<p>Example</p>",
            "questions": [{"key": "business_model", "prompt": "What?", "required": True}],
            "budget": {
                "maxRuntimeMs": 30_000,
                "maxModelCalls": 1,
                "maxInputTokens": 5_000,
                "maxOutputTokens": 500,
                "maxCostUsd": 1,
            },
        },
    })

    assert result == expected


def test_research_surfaces_invalid_provider_output_instead_of_silent_empty_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class InvalidClient:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            pass

        def extract(self, _request: object) -> object:
            raise ProviderOutputRejected("provider returned an invalid finding")

    monkeypatch.setenv("MINIMAX_API_KEY", "subscription-key")
    monkeypatch.setattr(runner, "MiniMaxClient", InvalidClient)

    with pytest.raises(ProviderOutputRejected, match="invalid finding"):
        runner.result_for({
        "kind": "research",
        "payload": {
            "source": {
                "sourceUrl": "https://example.com/",
                "sourceType": "official_site",
                "suppliedAt": "2026-10-02T12:00:00Z",
                "contentSha256": "0" * 64,
            },
            "content": '<p data-lh-field="business_model">Acme vende insumos mayoristas.</p>',
            "questions": [{"key": "business_model", "prompt": "What?", "required": True}],
            "budget": {
                "maxRuntimeMs": 30_000,
                "maxModelCalls": 1,
                "maxInputTokens": 5_000,
                "maxOutputTokens": 500,
                "maxCostUsd": 1,
            },
        },
    })


def test_discovery_applies_geography_filters_and_excludes_non_business_pages() -> None:
    from urllib.parse import parse_qs, urlsplit
    def opener(request: object, **_kwargs: object) -> FakeResponse:
        query = parse_qs(urlsplit(request.full_url).query)["q"][0]
        assert all(term in query for term in ("Argentina", "Mendoza", "ferreterías"))
        return FakeResponse({"results": [
            {"url": "https://wa.me/123", "title": "WhatsApp"},
            {"url": "https://youtube.com/shorts/123", "title": "Video"},
            {"url": "https://fenix.example/contacto", "title": "Contacto - Fenix"},
            {"url": "https://fenix.example/blog/ofertas", "title": "Fenix ofertas"},
            {"url": "https://instagram.com/negocio/", "title": "Negocio"},
        ]})
    result = runner.discover({"kind": "source_query", "source": "web_search", "query": "mayoristas", "country": "AR", "region": "Mendoza", "industry": "ferreterías"}, "http://search/", opener)
    candidates = result["output"]["candidates"]
    assert len(candidates) == 2
    assert candidates[0]["observedName"] == "Fenix"
    assert candidates[1]["metadata"]["identity"]["urls"][0]["role"] == "social_profile"


def test_contacts_use_exact_supplied_snapshot_without_refetching(monkeypatch: pytest.MonkeyPatch) -> None:
    import hashlib
    monkeypatch.setattr(runner, "fetch_text", lambda *_args: pytest.fail("must use captured content"))
    content = "Contact us: ventas@example.com"
    source = {"ref": "research:1", "sourceUrl": "https://example.com/contact", "suppliedAt": "2026-10-08T12:00:00Z", "contentSha256": hashlib.sha256(content.encode()).hexdigest(), "content": content}
    result = runner.contacts({"sources": [source]})
    assert result["observations"][0]["email"] == "ventas@example.com"
    source["contentSha256"] = "0" * 64
    with pytest.raises(ValueError, match="hash"):
        runner.contacts({"sources": [source]})


def test_contacts_do_not_treat_contact_form_examples_as_published_recipients() -> None:
    import hashlib
    content = "Email inválido (ej: tu@email.com). Consultas: ventas@empresa.com.ar"
    source = {"ref":"research:1", "sourceUrl":"https://empresa.com.ar/", "suppliedAt":"2026-10-08T12:00:00Z", "contentSha256":hashlib.sha256(content.encode()).hexdigest(), "content":content}
    assert [o["email"] for o in runner.contacts({"sources":[source]})["observations"]] == ["ventas@empresa.com.ar"]
