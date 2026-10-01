from __future__ import annotations

import json
import tomllib
from datetime import datetime, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError

from leadhunter_worker.contracts import (
    ExtractionBudget,
    ExtractionRequest,
    ExtractionResponse,
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
WORKER_ROOT = FIXTURES.parent.parent


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


def test_worker_metadata_supports_python_3_12_and_3_13() -> None:
    metadata = tomllib.loads((WORKER_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    assert metadata["project"]["requires-python"] == ">=3.12,<3.14"
    assert (WORKER_ROOT / ".python-version").read_text(encoding="utf-8").strip() == "3.12"
    assert metadata["project"]["optional-dependencies"]["scrapegraph"] == [
        "scrapegraphai==2.3.0",
    ]


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


def test_question_limit_matches_the_campaign_contract() -> None:
    base = request_for("active-official.html").model_dump(mode="json")
    hundred = [
        {"key": f"field_{index}", "prompt": f"Find field {index}", "required": False}
        for index in range(100)
    ]
    accepted = ExtractionRequest.model_validate({**base, "questions": hundred})
    assert len(accepted.questions) == 100
    with pytest.raises(ValidationError):
        ExtractionRequest.model_validate({
            **base,
            "questions": [
                {"key": f"field_{index}", "prompt": f"Find field {index}", "required": False}
                for index in range(101)
            ],
        })


def test_finding_limit_accepts_50_and_rejects_51() -> None:
    response = extract_offline(request_for("active-official.html"))
    payload = response.model_dump(mode="json")
    finding = payload["findings"][0]
    accepted = ExtractionResponse.model_validate({**payload, "findings": [finding] * 50})
    assert len(accepted.findings) == 50
    with pytest.raises(ValidationError):
        ExtractionResponse.model_validate({**payload, "findings": [finding] * 51})


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


def test_extract_is_required_for_grounded_provider_findings() -> None:
    raw = [{
        "field": "business.name",
        "value": "Andes Industrial",
        "status": "verified",
        "confidence": 90,
        "source_url": "https://andes.example/nosotros",
    }]
    with pytest.raises(ProviderOutputRejected, match="requires an exact evidence extract"):
        validate_provider_output(request_for("active-official.html"), raw)


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


@pytest.mark.parametrize(
    ("provider_config", "runner", "available", "reason"),
    [
        (None, None, False, "provider configuration"),
        ({"model": "provider/model"}, None, False, "runner"),
        (None, lambda _request, _config, _budget: {}, False, "provider configuration"),
        ({"model": ""}, lambda _request, _config, _budget: {}, False, "provider configuration"),
        ({"model": "provider/model"}, "not executable", False, "runner"),
        ({"model": "provider/model"}, lambda _request, _config: {}, False, "budget"),
        ({"model": "provider/model"}, lambda _request, _config, _budget: {}, True, ""),
    ],
)
def test_scrapegraph_availability_requires_config_and_executable_runner(
    provider_config: dict[str, str] | None,
    runner: object,
    available: bool,
    reason: str,
) -> None:
    adapter = ScrapeGraphAIExtractor(provider_config=provider_config, runner=runner)  # type: ignore[arg-type]
    assert adapter.available is available
    assert reason in adapter.unavailable_reason.lower()


def test_unavailable_scrapegraph_fails_before_calling_a_runner() -> None:
    called = False

    def runner(
        _request: ExtractionRequest,
        _config: dict[str, object],
        _budget: ExtractionBudget,
    ) -> dict[str, object]:
        nonlocal called
        called = True
        return {"findings": [], "usage": {}}

    adapter = ScrapeGraphAIExtractor(provider_config=None, runner=runner)
    with pytest.raises(RuntimeError, match="unavailable"):
        adapter.extract(request_for("active-official.html"))
    assert called is False


def test_scrapegraph_adapter_uses_reported_usage_and_the_same_grounding_validator() -> None:
    request = request_for("active-official.html")
    adapter = ScrapeGraphAIExtractor(
        provider_config={"model": "provider/model"},
        runner=lambda _request, _config, budget: {
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
            "enforced_budget": budget.model_dump(),
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


@pytest.mark.parametrize(
    "finding",
    [
        {
            "field": "business.name",
            "value": "Andes Industrial",
            "status": "verified",
            "confidence": 90,
            "source_url": "https://andes.example/nosotros",
            "extract": None,
        },
        {
            "field": "business.name",
            "value": "a",
            "status": "verified",
            "confidence": 90,
            "source_url": "https://andes.example/nosotros",
            "extract": "Andes Industrial",
        },
        {
            "field": "business.name",
            "value": "us",
            "status": "verified",
            "confidence": 90,
            "source_url": "https://andes.example/nosotros",
            "extract": "Industrial business solutions",
        },
        {
            "field": "business.name",
            "value": "Andes Industrial",
            "status": "verified",
            "confidence": 90,
            "source_url": "https://andes.example/nosotros",
            "extract": "Estado: Activo",
        },
        {
            "field": "business.name",
            "value": "Andes",
            "status": "verified",
            "confidence": 90,
            "source_url": "https://andes.example/nosotros",
            "extract": "AndesIndustrial",
        },
    ],
)
def test_grounding_rejects_missing_or_unlinked_substring_evidence(
    finding: dict[str, object],
) -> None:
    request = request_for("active-official.html")
    request = request.model_copy(update={
        "content": "<p>Andes Industrial</p><p>Industrial business solutions</p><p>Estado: Activo</p>",
    })

    with pytest.raises(ProviderOutputRejected, match="grounded|extract"):
        validate_provider_output(request, [finding])


def test_grounding_preserves_unicode_punctuation_email_url_and_address() -> None:
    request = request_for("active-official.html", keys=[
        "business.name",
        "business.address",
        "business.email",
        "business.website",
    ]).model_copy(update={
        "content": (
            "<p>Nombre: Río Claro S.A. — Dirección: San Martín 1200, Córdoba. "
            "Correo: ventas@rio-claro.example. Sitio: https://rio.example/catálogo?x=1</p>"
        ),
    })
    findings = [
        {
            "field": "business.name",
            "value": "Río Claro S.A.",
            "status": "verified",
            "confidence": 90,
            "source_url": str(request.source_url),
            "extract": "Nombre: Río Claro S.A.",
        },
        {
            "field": "business.address",
            "value": "San Martín 1200, Córdoba",
            "status": "verified",
            "confidence": 90,
            "source_url": str(request.source_url),
            "extract": "Dirección: San Martín 1200, Córdoba.",
        },
        {
            "field": "business.email",
            "value": "ventas@rio-claro.example",
            "status": "verified",
            "confidence": 90,
            "source_url": str(request.source_url),
            "extract": "Correo: ventas@rio-claro.example.",
        },
        {
            "field": "business.website",
            "value": "https://rio.example/catálogo?x=1",
            "status": "verified",
            "confidence": 90,
            "source_url": str(request.source_url),
            "extract": "Sitio: https://rio.example/catálogo?x=1",
        },
    ]

    assert validate_provider_output(request, findings) == [
        Finding.model_validate(finding) for finding in findings
    ]


def test_grounding_does_not_join_separate_visible_blocks() -> None:
    request = request_for("active-official.html").model_copy(update={
        "content": "<body><h1>ACME</h1><p>Industrial</p></body>",
    })
    finding = {
        "field": "business.name",
        "value": "ACME Industrial",
        "status": "verified",
        "confidence": 90,
        "source_url": str(request.source_url),
        "extract": "ACME Industrial",
    }

    with pytest.raises(ProviderOutputRejected, match="extract"):
        validate_provider_output(request, [finding])

    same_block = request.model_copy(update={
        "content": "<p>ACME Industrial</p>",
    })
    assert validate_provider_output(same_block, [finding]) == [
        Finding.model_validate(finding),
    ]


def test_grounding_accepts_contiguous_direct_body_text_with_inline_markup() -> None:
    request = request_for("active-official.html").model_copy(update={
        "content": "<body>ACME <strong>Industrial</strong></body>",
    })
    finding = {
        "field": "business.name",
        "value": "ACME Industrial",
        "status": "verified",
        "confidence": 90,
        "source_url": str(request.source_url),
        "extract": "ACME Industrial",
    }

    assert validate_provider_output(request, [finding]) == [
        Finding.model_validate(finding),
    ]


@pytest.mark.parametrize("value", ["de", "la", "y"])
def test_grounding_rejects_short_plain_alphabetic_values(value: str) -> None:
    request = request_for("active-official.html").model_copy(update={
        "content": f"<p>{value}</p>",
    })
    finding = {
        "field": "business.name",
        "value": value,
        "status": "inferred",
        "confidence": 80,
        "source_url": str(request.source_url),
        "extract": value,
    }

    with pytest.raises(ProviderOutputRejected, match="grounded"):
        validate_provider_output(request, [finding])


def test_scrapegraph_adapter_rejects_unreported_or_over_budget_usage() -> None:
    request = request_for("active-official.html")
    adapter = ScrapeGraphAIExtractor(
        provider_config={"model": "provider/model"},
        runner=lambda _request, _config, budget: {
            "findings": [],
            "usage": {"model_calls": 1},
            "enforced_budget": budget.model_dump(),
        },
    )
    with pytest.raises(ProviderOutputRejected, match="usage"):
        adapter.extract(request)


def test_scrapegraph_runner_receives_and_acknowledges_budget_before_invocation() -> None:
    request = request_for("active-official.html").model_copy(update={
        "budget": ExtractionBudget(
            max_runtime_ms=1_500,
            max_model_calls=1,
            max_input_tokens=700,
            max_output_tokens=120,
            max_cost_usd=0.04,
        ),
    })
    received: list[ExtractionBudget] = []

    def runner(
        _request: ExtractionRequest,
        _config: dict[str, object],
        budget: ExtractionBudget,
    ) -> dict[str, object]:
        received.append(budget)
        return {
            "findings": [],
            "usage": {
                "model_calls": 1,
                "input_tokens": 100,
                "output_tokens": 20,
                "estimated_cost_usd": 0.01,
            },
            "enforced_budget": budget.model_dump(),
        }

    adapter = ScrapeGraphAIExtractor(
        provider_config={"model": "provider/model"},
        runner=runner,
    )
    adapter.extract(request)
    assert received == [request.budget]


@pytest.mark.parametrize("acknowledgement", [None, "mismatch"])
def test_scrapegraph_rejects_missing_or_mismatched_budget_acknowledgement(
    acknowledgement: str | None,
) -> None:
    request = request_for("active-official.html").model_copy(update={
        "budget": ExtractionBudget(
            max_runtime_ms=2_000,
            max_model_calls=1,
            max_input_tokens=500,
            max_output_tokens=100,
            max_cost_usd=0.05,
        ),
    })

    def runner(
        _request: ExtractionRequest,
        _config: dict[str, object],
        budget: ExtractionBudget,
    ) -> dict[str, object]:
        result: dict[str, object] = {
            "findings": [],
            "usage": {
                "model_calls": 1,
                "input_tokens": 100,
                "output_tokens": 20,
                "estimated_cost_usd": 0.01,
            },
        }
        if acknowledgement == "mismatch":
            result["enforced_budget"] = {
                **budget.model_dump(),
                "max_cost_usd": budget.max_cost_usd + 1,
            }
        return result

    adapter = ScrapeGraphAIExtractor(
        provider_config={"model": "provider/model"},
        runner=runner,
    )
    with pytest.raises(ProviderOutputRejected, match="budget"):
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
