import json

import pytest

from leadhunter_worker.scrapegraph import ScrapeGraphResearch
from leadhunter_worker.extract import ProviderOutputRejected
from test_minimax import FakeResponse, request as base_request


def request():
    return base_request().model_copy(update={"content": "Acme vende insumos mayoristas en Córdoba."})


def test_real_graph_uses_minimax_and_preserves_source_evidence():
    calls = []

    def opener(http_request, timeout):
        payload = json.loads(http_request.data)
        calls.append(payload)
        assert "Acme vende insumos" in payload["input"]
        assert "business_model" in payload["input"]
        return FakeResponse({
            "status": "completed",
            "output_text": json.dumps({"findings": [{
                "field": "business_model", "start_line": 1, "end_line": 1, "confidence": 95,
            }]}),
            "usage": {"input_tokens": 300, "output_tokens": 80},
        })

    result = ScrapeGraphResearch("test-key", opener=opener).extract(request())
    assert len(calls) == 1
    assert result.usage.extractor == "scrapegraphai-2.3.0"
    assert result.usage.input_tokens == 300
    assert result.findings[0].value == "Acme vende insumos mayoristas en Córdoba."
    assert "graph:SmartScraperGraph" in result.diagnostics


def test_graph_rejects_invented_evidence():
    def opener(*args, **kwargs):
        return FakeResponse({"status": "completed", "output_text": json.dumps({"findings": [{
            "field": "business_model", "start_line": 999, "end_line": 999, "confidence": 95,
        }]}), "usage": {"input_tokens": 300, "output_tokens": 80}})

    with pytest.raises(ProviderOutputRejected, match="grounded"):
        ScrapeGraphResearch("test-key", opener=opener).extract(request())


def test_zero_model_budget_never_calls_provider():
    source = request()
    source = source.model_copy(update={"budget": source.budget.model_copy(update={"max_model_calls": 0})})
    with pytest.raises(ValueError, match="budget"):
        ScrapeGraphResearch("test-key", opener=lambda *a, **kw: pytest.fail("unexpected request")).extract(source)


def test_invalid_span_is_reported_without_losing_other_grounded_findings():
    def opener(*args, **kwargs):
        return FakeResponse({"status": "completed", "output_text": json.dumps({"findings": [
            {"field": "business_model", "start_line": 1, "end_line": 1, "confidence": 95},
            {"field": "business_model", "start_line": 999, "end_line": 999, "confidence": 95},
        ]}), "usage": {"input_tokens": 300, "output_tokens": 80}})
    result = ScrapeGraphResearch("test-key", opener=opener).extract(request())
    assert len(result.findings) == 1
    assert "discarded_span:business_model:999-999" in result.diagnostics
