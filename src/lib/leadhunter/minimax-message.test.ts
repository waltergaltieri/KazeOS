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

  it.each([undefined, null, ""])("allows an omitted secondary opportunity (%s) without adding an intermediate invitation", async (secondaryOpportunity) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: "completed", output_text: JSON.stringify({
      subject: "Una idea para Distribuidora PPP", opening: "Hola,",
      businessUnderstanding: brief.facts.map(({ id, value }) => ({ text: value, evidenceIds: [id] })),
      primaryOpportunity: "Podríamos evaluar un catálogo propio.",
      operationsTransition: "¿Coordinamos una reunión para revisar herramientas?",
      secondaryOpportunity,
    }) })));
    const result = await composeProspectMessageWithMiniMax(brief, { apiKey: "test", fetch: fetcher as typeof fetch });
    expect(result.body.split("\n\n")).toEqual([
      "Hola,", brief.policy.intro, brief.facts.map(({ value }) => value).join(" "),
      "Podríamos evaluar un catálogo propio.", brief.policy.commercialModel, brief.policy.cta, brief.policy.signature,
    ]);
  });

  it("passes the campaign tone and a word budget that accounts for fixed sections", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: "completed", output_text: JSON.stringify({
      subject: "Una idea para Distribuidora PPP", opening: "Hola,",
      businessUnderstanding: brief.facts.map(({ id, value }) => ({ text: value, evidenceIds: [id] })),
      primaryOpportunity: "Podríamos evaluar un catálogo propio.",
      secondaryOpportunity: "También podría tener sentido evaluar el seguimiento de pedidos.",
    }) })));
    const result = await composeProspectMessageWithMiniMax({ ...brief, secondaryOpportunity: "seguimiento de pedidos" }, { apiKey: "test", fetch: fetcher as typeof fetch });
    const request = JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    const input = JSON.parse(request.input);
    expect(input.writingStyle.tone).toBe(brief.policy.tone);
    const fixedWords = [brief.policy.intro, brief.policy.commercialModel, brief.policy.cta, brief.policy.signature].join(" ").split(/\s+/u).length;
    expect(input.writingStyle.customWordRange).toEqual({ minimum: 250 - fixedWords, maximum: 400 - fixedWords });
    expect(result.body).toContain("También podría tener sentido evaluar el seguimiento de pedidos.");
    expect(result.body.match(/¿Conversamos\?/gu)).toHaveLength(1);
  });

  it("does not append an unsolicited second pitch to the primary solution", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: "completed", output_text: JSON.stringify({
      subject: "Una idea para Distribuidora PPP", opening: "Hola,",
      businessUnderstanding: brief.facts.map(({ id, value }) => ({ text: value, evidenceIds: [id] })),
      primaryOpportunity: "Podemos desarrollar un sistema para gestionar pedidos personalizados.",
      secondaryOpportunity: "Como idea para validar después, se podría explorar un pequeño portal para los mismos pedidos.",
    }) })));
    const result = await composeProspectMessageWithMiniMax(brief, { apiKey: "test", fetch: fetcher as typeof fetch });
    expect(result.body).toContain("Podemos desarrollar un sistema para gestionar pedidos personalizados.");
    expect(result.body).not.toContain("pequeño portal");
  });

  it("assembles factual prose and evidence from the same sentences", async () => {
    const sentences = brief.facts.map(({ id, value }) => ({ text: value, evidenceIds: [id] }));
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: "completed", output_text: JSON.stringify({
      subject: "Una idea para Distribuidora PPP", opening: "Hola,", businessUnderstanding: sentences,
      primaryOpportunity: "Podríamos evaluar una mejora.", operationsTransition: "¿Qué herramientas utilizan?", secondaryOpportunity: "Podemos revisar juntos el alcance.",
    }) })));
    const result = await composeProspectMessageWithMiniMax(brief, { apiKey: "test", fetch: fetcher as typeof fetch });
    expect(result.claims).toEqual(sentences);
    for (const sentence of sentences) expect(result.body).toContain(sentence.text);
  });

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
    expect(request.instructions).toContain("Select three complementary business facts");
    expect(request.instructions).toContain("NOT three products or specifications");
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
