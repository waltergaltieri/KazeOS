from __future__ import annotations

import json

from leadhunter_worker.contracts import ExtractionBudget, ExtractionRequest
from leadhunter_worker.minimax import MiniMaxClient


class FakeResponse:
    status = 200

    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = json.dumps(payload).encode()

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self, size: int) -> bytes:
        return self._payload[:size]


def request() -> ExtractionRequest:
    return ExtractionRequest.model_validate({
        "source_url": "https://example.com/",
        "source_type": "official_site",
        "supplied_at": "2026-10-02T12:00:00Z",
        "content": "<p>Acme vende insumos mayoristas en Córdoba.</p>",
        "questions": [{
            "key": "business_model",
            "prompt": "¿Qué hace el negocio?",
            "required": True,
        }],
        "budget": {
            "max_runtime_ms": 30_000,
            "max_model_calls": 1,
            "max_input_tokens": 5_000,
            "max_output_tokens": 500,
            "max_cost_usd": 1,
        },
    })


def test_minimax_extracts_only_grounded_structured_findings() -> None:
    captured: list[object] = []

    def opener(http_request: object, timeout: int) -> FakeResponse:
        captured.append(http_request)
        assert timeout == 30
        return FakeResponse({
            "status": "completed",
            "output_text": json.dumps({"findings": [{
                "field": "business_model",
                "value": "vende insumos mayoristas",
                "status": "verified",
                "confidence": 92,
                "source_url": "https://example.com/",
                "extract": "Acme vende insumos mayoristas en Córdoba.",
            }]}),
            "usage": {"input_tokens": 120, "output_tokens": 40},
        })

    result = MiniMaxClient(
        api_key="secret",
        base_url="https://api.minimax.io/v1",
        model="MiniMax-M3",
        opener=opener,
    ).extract(request())

    sent = json.loads(captured[0].data)  # type: ignore[attr-defined]
    assert sent["model"] == "MiniMax-M3"
    assert sent["reasoning"] == {"effort": "none"}
    assert "untrusted evidence" in sent["instructions"]
    assert result.findings[0].value == "vende insumos mayoristas"
    assert result.usage.extractor == "minimax:MiniMax-M3"
    assert result.usage.model_calls == 1
    assert result.usage.input_tokens == 120
    assert result.usage.output_tokens == 40


def test_minimax_rejects_findings_not_grounded_in_the_supplied_page() -> None:
    def opener(_request: object, timeout: int) -> FakeResponse:
        assert timeout == 30
        return FakeResponse({
            "status": "completed",
            "output_text": json.dumps({"findings": [{
                "field": "business_model",
                "value": "duplica ventas con inteligencia artificial",
                "status": "verified",
                "confidence": 99,
                "source_url": "https://example.com/",
                "extract": "duplica ventas con inteligencia artificial",
            }]}),
            "usage": {"input_tokens": 100, "output_tokens": 30},
        })

    client = MiniMaxClient("secret", opener=opener)

    try:
        client.extract(request())
    except ValueError as error:
        assert "grounded" in str(error)
    else:
        raise AssertionError("ungrounded model output must be rejected")


def test_minimax_refuses_a_request_whose_budget_disallows_model_calls() -> None:
    value = request().model_copy(update={
        "budget": ExtractionBudget(
            max_runtime_ms=30_000,
            max_model_calls=0,
            max_input_tokens=5_000,
            max_output_tokens=500,
            max_cost_usd=1,
        ),
    })

    client = MiniMaxClient("secret", opener=lambda *_args: None)

    try:
        client.extract(value)
    except ValueError as error:
        assert "model calls" in str(error)
    else:
        raise AssertionError("a zero-call budget must not invoke MiniMax")
