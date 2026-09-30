from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError

from leadhunter_worker.contracts import (
    ExtractionBudget,
    ExtractionRequest,
    Finding,
    ResearchQuestion,
)
from leadhunter_worker.extract import (
    ProviderOutputRejected,
    ScrapeGraphAIExtractor,
    extract_offline,
    validate_provider_output,
)

FIXTURES = Path(__file__).parent / "fixtures"


def request_for(name: str, keys: list[str] | None = None) -> ExtractionRequest:
    manifest = json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))
    entry = manifest[name]
    questions = [
        ResearchQuestion(key=key, prompt=f"Find {key}", required=key == "business.name")
        for key in (keys or list(entry["expected"]))
    ]
    return ExtractionRequest(
        source_url=entry["source_url"],
        source_type="official_site" if "directory" not in entry["source_url"] else "directory",
        supplied_at=datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc),
        content=(FIXTURES / name).read_text(encoding="utf-8"),
        questions=questions,
        budget=ExtractionBudget(
            max_runtime_ms=2_000,
            max_model_calls=0,
            max_input_tokens=0,
            max_output_tokens=0,
            max_cost_usd=0,
        ),
    )


def test_contracts_are_strict_and_bounded() -> None:
    with pytest.raises(ValidationError):
        ExtractionRequest.model_validate({
            **request_for("active-official.html").model_dump(mode="json"),
            "database_url": "postgres://forbidden",
        })
    with pytest.raises(ValidationError):
        Finding(
            field="business.name",
            value="Andes Industrial",
            status="verified",
            confidence=101,
            source_url="https://andes.example/",
            extract=None,
        )
    with pytest.raises(ValidationError):
        ExtractionRequest.model_validate({
            **request_for("active-official.html").model_dump(mode="json"),
            "source_url": "file:///etc/passwd",
        })
    with pytest.raises(ValidationError):
        ExtractionRequest.model_validate({
            **request_for("active-official.html").model_dump(mode="json"),
            "source_url": "https://user:password@andes.example/nosotros",
        })


def test_offline_extractor_is_deterministic_grounded_and_injection_safe() -> None:
    request = request_for("prompt-injection.html")
    first = extract_offline(request)
    second = extract_offline(request)

    assert first.findings == second.findings
    assert {finding.field for finding in first.findings} == {
        "business.name",
        "business.activity",
    }
    assert all(str(finding.source_url) == "https://rioclaro.example/empresa" for finding in first.findings)
    assert "secrets" not in json.dumps(first.model_dump(mode="json")).lower()
    assert first.usage.model_calls == 0
    assert first.usage.estimated_cost_usd == 0
    assert first.content_sha256 == second.content_sha256


def test_conflicting_values_remain_conflicting() -> None:
    response = extract_offline(request_for("conflicting-addresses.html"))
    addresses = [finding for finding in response.findings if finding.field == "business.address"]
    assert [finding.value for finding in addresses] == [
        "Belgrano 450, Córdoba",
        "Belgrano 540, Córdoba",
    ]
    assert {finding.status for finding in addresses} == {"conflicting"}


def test_empty_content_yields_a_valid_empty_result() -> None:
    response = extract_offline(request_for("empty.html", keys=["business.name"]))
    assert response.findings == []
    assert response.diagnostics == ["content_empty"]


def test_published_email_keeps_exact_source_and_extract() -> None:
    response = extract_offline(request_for("published-email.html"))
    email = next(finding for finding in response.findings if finding.field == "business.email")
    assert email.value == "ventas@patagonia-envases.example"
    assert email.extract == "ventas@patagonia-envases.example"
    assert str(email.source_url) == "https://patagonia-envases.example/contacto"


def test_extract_is_optional_at_the_worker_boundary() -> None:
    raw = [{
        "field": "business.name",
        "value": "Andes Industrial",
        "status": "verified",
        "confidence": 90,
        "source_url": "https://andes.example/nosotros",
    }]
    accepted = validate_provider_output(request_for("active-official.html"), raw)
    assert accepted[0].extract is None


@pytest.mark.parametrize(
    "raw",
    [
        [{"field": "unsupported", "value": "invented", "status": "verified", "confidence": 90,
          "source_url": "https://andes.example/nosotros", "extract": "invented"}],
        [{"field": "business.name", "value": "Invented Corp", "status": "verified", "confidence": 90,
          "source_url": "https://andes.example/nosotros", "extract": "Invented Corp"}],
        [{"field": "business.name", "value": "Andes Industrial", "status": "verified", "confidence": 90,
          "source_url": "https://elsewhere.example/", "extract": "Andes Industrial"}],
        [{"field": "business.name", "value": "Andes Industrial", "status": "verified", "confidence": 90,
          "source_url": "https://andes.example/nosotros", "extract": "Andes Industrial", "action": "send_mail"}],
    ],
)
def test_provider_output_rejects_unsupported_ungrounded_or_extra_claims(raw: list[dict[str, object]]) -> None:
    with pytest.raises(ProviderOutputRejected):
        validate_provider_output(request_for("active-official.html"), raw)


def test_scrapegraph_adapter_is_explicitly_unavailable_without_provider_config() -> None:
    adapter = ScrapeGraphAIExtractor(provider_config=None)
    assert adapter.available is False
    assert "provider configuration" in adapter.unavailable_reason.lower()
    with pytest.raises(RuntimeError, match="unavailable"):
        adapter.extract(request_for("active-official.html"))


def test_scrapegraph_adapter_uses_reported_usage_and_the_same_grounding_validator() -> None:
    request = request_for("active-official.html")
    adapter = ScrapeGraphAIExtractor(
        provider_config={"model": "provider/model"},
        runner=lambda _request, _config: {
            "findings": [{
                "field": "business.name",
                "value": "Andes Industrial",
                "status": "verified",
                "confidence": 88,
                "source_url": "https://andes.example/nosotros",
                "extract": "Andes Industrial",
            }],
            "usage": {
                "model_calls": 1,
                "input_tokens": 120,
                "output_tokens": 40,
                "estimated_cost_usd": 0.012,
            },
        },
    )
    request = request.model_copy(update={
        "budget": ExtractionBudget(
            max_runtime_ms=2_000,
            max_model_calls=1,
            max_input_tokens=500,
            max_output_tokens=100,
            max_cost_usd=0.05,
        ),
    })

    response = adapter.extract(request)

    assert response.usage.model_calls == 1
    assert response.usage.input_tokens == 120
    assert response.usage.output_tokens == 40
    assert response.usage.estimated_cost_usd == 0.012


def test_scrapegraph_adapter_rejects_unreported_or_over_budget_usage() -> None:
    request = request_for("active-official.html")
    adapter = ScrapeGraphAIExtractor(
        provider_config={"model": "provider/model"},
        runner=lambda _request, _config: {"findings": [], "usage": {"model_calls": 1}},
    )
    with pytest.raises(ProviderOutputRejected, match="usage"):
        adapter.extract(request)


def test_local_fixture_accuracy_and_unsupported_claim_rate_are_measured() -> None:
    manifest = json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))
    expected_pairs: set[tuple[str, str, str]] = set()
    actual_pairs: set[tuple[str, str, str]] = set()
    total_elapsed = 0
    for filename, entry in manifest.items():
        response = extract_offline(request_for(filename, keys=list(entry["expected"]) or ["business.name"]))
        total_elapsed += response.usage.elapsed_ms
        expected_pairs |= {
            (filename, field, value)
            for field, values in entry["expected"].items()
            for value in values
        }
        actual_pairs |= {(filename, finding.field, finding.value) for finding in response.findings}

    assert expected_pairs <= actual_pairs
    assert not (actual_pairs - expected_pairs)
    assert total_elapsed < 2_000
