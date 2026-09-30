from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    HttpUrl,
    StringConstraints,
    field_validator,
    model_validator,
)

FieldKey = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=100, pattern=r"^[a-z][a-z0-9_.-]*$"),
]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ResearchQuestion(StrictModel):
    key: FieldKey
    prompt: ShortText
    required: bool


class ExtractionBudget(StrictModel):
    max_runtime_ms: int = Field(ge=50, le=120_000)
    max_model_calls: int = Field(ge=0, le=10)
    max_input_tokens: int = Field(ge=0, le=200_000)
    max_output_tokens: int = Field(ge=0, le=20_000)
    max_cost_usd: float = Field(ge=0, le=100)


class ExtractionRequest(StrictModel):
    source_url: HttpUrl
    source_type: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    supplied_at: datetime
    content: str = Field(max_length=100_000)
    questions: list[ResearchQuestion] = Field(min_length=1, max_length=100)
    budget: ExtractionBudget

    @field_validator("source_url")
    @classmethod
    def require_http(cls, value: HttpUrl) -> HttpUrl:
        if value.scheme not in {"http", "https"}:
            raise ValueError("source_url must use HTTP(S)")
        if value.username is not None or value.password is not None:
            raise ValueError("source_url must not contain credentials")
        return value

    @field_validator("supplied_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("supplied_at must include a timezone")
        return value

    @model_validator(mode="after")
    def require_unique_questions(self) -> "ExtractionRequest":
        keys = [question.key for question in self.questions]
        if len(keys) != len(set(keys)):
            raise ValueError("question keys must be unique")
        return self


class Finding(StrictModel):
    field: FieldKey
    value: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2_000)]
    status: Literal["verified", "inferred", "conflicting"]
    confidence: int = Field(ge=0, le=100)
    source_url: HttpUrl
    extract: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1_000)] | None = None

    @field_validator("source_url")
    @classmethod
    def require_http(cls, value: HttpUrl) -> HttpUrl:
        if value.scheme not in {"http", "https"}:
            raise ValueError("source_url must use HTTP(S)")
        if value.username is not None or value.password is not None:
            raise ValueError("source_url must not contain credentials")
        return value


class ExtractionUsage(StrictModel):
    extractor: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    elapsed_ms: int = Field(ge=0, le=120_000)
    model_calls: int = Field(ge=0, le=10)
    input_tokens: int = Field(ge=0, le=200_000)
    output_tokens: int = Field(ge=0, le=20_000)
    estimated_cost_usd: float = Field(ge=0, le=100)


class ProviderUsageReport(StrictModel):
    model_calls: int = Field(ge=1, le=10)
    input_tokens: int = Field(ge=0, le=200_000)
    output_tokens: int = Field(ge=0, le=20_000)
    estimated_cost_usd: float = Field(ge=0, le=100)


class ProviderRunResult(StrictModel):
    findings: list[dict[str, Any]] = Field(max_length=50)
    usage: ProviderUsageReport
    enforced_budget: ExtractionBudget


class ExtractionResponse(StrictModel):
    source_url: HttpUrl
    source_type: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    supplied_at: datetime
    content_sha256: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
    findings: list[Finding] = Field(max_length=50)
    diagnostics: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]] = Field(max_length=20)
    usage: ExtractionUsage
