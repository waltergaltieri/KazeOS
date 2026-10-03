// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { MessageBrief } from "./message-brief";
import { composeFollowUpsWithMiniMax, composeProspectMessageWithMiniMax } from "./minimax-message";

const brief: MessageBrief = {
  campaignId: "00000000-0000-4000-8000-000000000001",
  campaignVersion: 1,
  enrollmentId: "00000000-0000-4000-8000-000000000002",
  companyName: "Distribuidora PPP",
  contact: { id: "00000000-0000-4000-8000-000000000003", email: "info@example.com" },
  facts: [
    { id: "00000000-0000-4000-8000-000000000011", field: "business_model", value: "Distribuye alimentos y bebidas a comercios de barrio.", status: "verified", confidence: 90 },
    { id: "00000000-0000-4000-8000-000000000012", field: "observable_process", value: "Publica un catálogo para kioscos, almacenes y supermercados.", status: "verified", confidence: 90 },
    { id: "00000000-0000-4000-8000-000000000013", field: "service_opportunity", value: "Recibe consultas comerciales para compras mayoristas.", status: "verified", confidence: 90 },
  ],
  primaryOpportunity: "ordenar la gestión de pedidos",
  policy: {
    language: "es-AR",
    tone: "Profesional",
    minimumSpecificFacts: 3,
    wordRange: { minimum: 250, maximum: 400 },
    intro: "Soy Walter, cofundador de KazeCode.",
    commercialModel: "Trabajamos mediante una suscripción mensual.",
    cta: "¿Conversamos?",
    signature: "Walter Quimey Galtieri\nCo-Founder, KazeCode",
    requiredSections: ["cta", "signature"],
    restrictedPhrases: [],
  },
};

describe("MiniMax LeadHunter message composition", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("requests a grounded structured email and parses the response", async () => {
    const output = {
      subject: "Una idea para Distribuidora PPP",
      opening: "Estuve mirando Distribuidora PPP.",
      businessUnderstanding: "Distribuye alimentos y bebidas a comercios de barrio.",
      primaryOpportunity: "El catálogo puede presentar mejor su oferta mayorista.",
      operationsTransition: "Ordenar el ingreso de consultas puede reducir tareas manuales.",
      secondaryOpportunity: "Podría centralizar pedidos y consultas sin asumir su proceso interno.",
      claims: brief.facts.map(({ id, value }) => ({ text: value, evidenceIds: [id] })),
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      status: "completed",
      output_text: JSON.stringify(output),
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(composeProspectMessageWithMiniMax(brief, {
      apiKey: "secret",
      fetch: fetcher as typeof fetch,
    })).resolves.toMatchObject({
      subject: output.subject,
      claims: output.claims,
      body: expect.stringContaining(brief.policy.signature),
    });

    const fetchCall = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const request = JSON.parse(String(fetchCall[1].body));
    expect(request.instructions).toContain("at least three company-specific details");
    expect(request.instructions).toContain("Do not add operational examples");
    expect(request.instructions).toContain("correct Spanish spelling and accents");
    expect(request.instructions).toContain("Never put evidence IDs");
    expect(request.input).toContain("Walter Quimey Galtieri");
  });

  it("rejects provider output without grounded claims", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      status: "completed",
      output_text: JSON.stringify({ subject: "Una idea", body: "Texto", claims: [] }),
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(composeProspectMessageWithMiniMax(brief, {
      apiKey: "secret",
      fetch: fetcher as typeof fetch,
    })).rejects.toThrow();
  });

  it("accepts grounded claims when the provider JSON-encodes the claims array", async () => {
    const claims = brief.facts.map(({ id, value }) => ({ text: value, evidenceIds: [id] }));
    const output = {
      subject: "Una idea para Distribuidora PPP",
      opening: "Estuve mirando Distribuidora PPP.",
      businessUnderstanding: brief.facts[0]!.value,
      primaryOpportunity: brief.facts[1]!.value,
      operationsTransition: "Ordenar el ingreso de consultas puede reducir tareas manuales.",
      secondaryOpportunity: brief.facts[2]!.value,
      claims: JSON.stringify(claims),
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      status: "completed",
      output_text: JSON.stringify(output),
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(composeProspectMessageWithMiniMax(brief, {
      apiKey: "secret",
      fetch: fetcher as typeof fetch,
    })).resolves.toMatchObject({ claims });
  });

  it("creates exactly one structured follow-up per configured step", async () => {
    const followUp = {
      body: "Seguimiento de prueba",
      claims: [{
        text: brief.facts[0]!.value,
        evidenceIds: [brief.facts[0]!.id],
      }],
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      status: "completed",
      output_text: JSON.stringify({ follow_ups: [followUp, followUp] }),
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(composeFollowUpsWithMiniMax(
      brief,
      "Una idea para Distribuidora PPP",
      [
        { subjectInstruction: "Mismo hilo", bodyInstruction: "Retomar la idea" },
        { subjectInstruction: "Mismo hilo", bodyInstruction: "Cerrar con respeto" },
      ],
      { apiKey: "secret", fetch: fetcher as typeof fetch },
    )).resolves.toEqual([followUp, followUp].map((item) => ({
      ...item,
      subject: "Re: Una idea para Distribuidora PPP",
      body: `${item.body}\n\n${brief.policy.signature}`,
    })));
  });
});
